import { sendRelayCapacityError, sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import type { RoomRecord, TeamMemberRecord, TeamRecord, TeamRole } from "@multaiplayer/protocol";
import { RelayStoreCapacityError, type AuthSession, type RelayStore } from "../state.js";
import {
  acquireDurableQuotaTransaction,
  nextUtcMidnight,
  reserveDurableQuota,
  rollbackDurableQuota
} from "../auth/account-quotas.js";
import {
  acquireAccountMutationTurn,
  acquireAccountMutationTurns,
  isLiveAccountSession
} from "../auth/account-mutation-transaction.js";

interface RegisterTeamRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowRead: (session: AuthSession | null, res: Response) => boolean;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  teamIdsForUser: (userId: string) => Set<string>;
  isTeamMember: (teamId: string, userId: string) => boolean;
  teamRoleRank: (role: TeamRole) => number;
  canSetTeamMemberRole: (requesterRole: TeamRole | undefined, targetRole: TeamRole, nextRole: TeamRole) => boolean;
  canRemoveTeamMember: (requesterRole: TeamRole | undefined, targetRole: TeamRole) => boolean;
  transferTeamOwnership: (
    members: Map<string, TeamMemberRecord>,
    nextOwnerUserId: string
  ) => Map<string, TeamMemberRecord>;
  revokeTeamInvites: (teamId: string) => void;
  revokeTeamMemberSessions: (teamId: string, userId: string) => void;
  broadcastWorkspaceUpdated: (team: TeamRecord) => void;
  broadcastRoomUpdated: (room: RoomRecord) => void;
  scheduleStoreSave: () => void;
  saveRelayStore: () => Promise<void>;
  recordQuotaRejection?: (type: string) => void;
  recordCapacityRejection?: (resource: string, scope: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxTeamNameChars: number;
  dailyCreationCaps?: { teamsPerUser: number };
}

export function registerTeamRoutes(options: RegisterTeamRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowRead,
    allowMutation,
    teamIdsForUser,
    isTeamMember,
    teamRoleRank,
    canSetTeamMemberRole,
    transferTeamOwnership,
    revokeTeamInvites,
    broadcastWorkspaceUpdated,
    broadcastRoomUpdated,
    scheduleStoreSave,
    normalizeMetadataText,
    maxTeamNameChars
  } = options;
  app.get("/teams", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const visibleTeamIds = session ? teamIdsForUser(session.user.id) : new Set(store.allTeams().map((team) => team.id));
    const visibleTeams = store.allTeams().filter((team) => visibleTeamIds.has(team.id) && !team.deletedAt);
    res.json({
      teams: visibleTeams.map((team) => teamRecordForUser(team, store, session?.user.id)),
      rooms: store
        .allRooms()
        .filter((room) => visibleTeamIds.has(room.teamId) && !room.deletedAt && !store.getTeam(room.teamId)?.deletedAt)
    });
  });

  app.get("/teams/:teamId/members", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    if (!store.hasTeam(teamId)) {
      sendRelayError(res, 404, "team_not_found", "Team not found");
      return;
    }
    if (session && !isTeamMember(teamId, session.user.id)) {
      sendRelayError(res, 403, "forbidden", "Join this team before reading its member list.");
      return;
    }
    res.json({ members: listTeamMembers(teamId, store, teamRoleRank) });
  });

  app.patch("/teams/:teamId/members/:userId", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const userId = String(req.params.userId ?? "");
    const role = parseRequestedTeamRole(req.body?.role);
    if (!store.hasTeam(teamId)) {
      sendRelayError(res, 404, "team_not_found", "Team not found");
      return;
    }
    if (!role || role === "owner") {
      sendRelayError(res, 400, "invalid_request", "role must be admin or member");
      return;
    }
    const members = store.getTeamMembers(teamId);
    const target = store.getTeamMember(teamId, userId);
    if (!members || !target) {
      sendRelayError(res, 404, "team_member_not_found", "Team member not found");
      return;
    }
    const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
    if (!canSetTeamMemberRole(requesterRole, target.role, role)) {
      sendRelayError(res, 403, "forbidden", "Only team owners can change admin roles.");
      return;
    }

    const updated: TeamMemberRecord = { ...target, role };
    members.set(userId, updated);
    scheduleStoreSave();
    res.json({ member: updated, members: listTeamMembers(teamId, store, teamRoleRank) });
  });

  app.post("/teams/:teamId/members/:userId/transfer-owner", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const userId = String(req.params.userId ?? "");
    const releaseAccountMutations = session
      ? await acquireAccountMutationTurns(store, [session.user.id, userId])
      : null;
    try {
      if (session && !isLiveAccountSession(store, session)) {
        return void sendRelayError(res, 401, "authentication_required", "Sign in before transferring ownership.");
      }
      if (!store.hasTeam(teamId)) {
        sendRelayError(res, 404, "team_not_found", "Team not found");
        return;
      }
      const members = store.getTeamMembers(teamId);
      const target = store.getTeamMember(teamId, userId);
      if (!members || !target) {
        sendRelayError(res, 404, "team_member_not_found", "Team member not found");
        return;
      }
      const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
      if (requesterRole !== "owner") {
        sendRelayError(res, 403, "forbidden", "Only the current team owner can transfer ownership.");
        return;
      }
      if (session?.user.id && session.user.id === userId) {
        sendRelayError(res, 400, "invalid_request", "Choose a different team member before transferring ownership.");
        return;
      }

      const previousMembers = new Map(members);
      const updatedMembers = transferTeamOwnership(members, userId);
      const team = store.getTeam(teamId);
      try {
        scheduleStoreSave();
      } catch {
        store.setTeamMembers(teamId, previousMembers);
        return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist team ownership transfer.");
      }
      if (team) broadcastWorkspaceUpdated(team);
      res.json({ member: updatedMembers.get(userId), members: listTeamMembers(teamId, store, teamRoleRank) });
    } finally {
      releaseAccountMutations?.();
    }
  });

  app.delete("/teams/:teamId/members/:userId", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const userId = String(req.params.userId ?? "");
    const releaseAccountMutations = await acquireAccountMutationTurns(
      store,
      session ? [session.user.id, userId] : [userId]
    );
    try {
      if (session && !isLiveAccountSession(store, session)) {
        return void sendRelayError(res, 401, "authentication_required", "Sign in before removing a team member.");
      }
      removeTeamMemberWithinAccountTurns(options, session, teamId, userId, res);
    } finally {
      releaseAccountMutations();
    }
  });

  app.patch("/teams/:teamId/lifecycle", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const action = String(req.body?.action ?? "");
    const team = store.getTeam(teamId);
    if (!team || team.deletedAt) {
      sendRelayError(res, 404, "team_not_found", "Team not found");
      return;
    }
    const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
    if (session && !requesterRole) {
      sendRelayError(res, 403, "forbidden", "Join this team before changing its archive state.");
      return;
    }
    if (!isTeamLifecycleAction(action)) {
      sendRelayError(res, 400, "invalid_request", "action must be archive, restore, or delete");
      return;
    }
    const authorizationError = teamLifecycleAuthorizationError(action, requesterRole);
    if (authorizationError) return void sendRelayError(res, 403, "forbidden", authorizationError);

    const now = new Date().toISOString();
    const updatedTeam = teamAfterLifecycleAction(team, action, now);
    store.setTeam(updatedTeam);

    const updatedRooms: RoomRecord[] = [];
    for (const room of store.allRooms().filter((item) => item.teamId === teamId && !item.deletedAt)) {
      const updatedRoom = roomAfterTeamLifecycleAction(room, action, now);
      store.setRoom(updatedRoom);
      updatedRooms.push(updatedRoom);
    }

    if (action === "delete") revokeTeamInvites(teamId);
    scheduleStoreSave();
    broadcastWorkspaceUpdated(updatedTeam);
    for (const room of updatedRooms) broadcastRoomUpdated(room);
    res.json({ team: teamRecordForUser(updatedTeam, store, session?.user.id), rooms: updatedRooms });
  });

  app.post("/teams", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const name = normalizeMetadataText(req.body?.name, maxTeamNameChars);
    if (!name) {
      sendRelayError(
        res,
        400,
        "invalid_request",
        `Team name is required and must be up to ${maxTeamNameChars} characters`
      );
      return;
    }
    const releaseAccountMutation = session ? await acquireAccountMutationTurn(store, session.user.id) : null;
    try {
      if (session && !isLiveAccountSession(store, session)) {
        return void sendRelayError(res, 401, "authentication_required", "Sign in before creating a team.");
      }
      await createTeamWithinAccountTurn({ session, name, res }, options);
    } finally {
      releaseAccountMutation?.();
    }
  });
}

function removeTeamMemberWithinAccountTurns(
  options: RegisterTeamRoutesOptions,
  session: AuthSession | null,
  teamId: string,
  userId: string,
  res: Response
): void {
  const { store, canRemoveTeamMember, revokeTeamInvites, revokeTeamMemberSessions, scheduleStoreSave } = options;
  if (!store.hasTeam(teamId)) {
    sendRelayError(res, 404, "team_not_found", "Team not found");
    return;
  }
  const members = store.getTeamMembers(teamId);
  const target = store.getTeamMember(teamId, userId);
  if (!members || !target) {
    sendRelayError(res, 404, "team_member_not_found", "Team member not found");
    return;
  }
  const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
  if (!canRemoveTeamMember(requesterRole, target.role)) {
    sendRelayError(res, 403, "forbidden", "Only team owners can remove admins, and owners cannot be removed.");
    return;
  }
  const retainedHostedRoom = store
    .allRooms()
    .find((room) => room.teamId === teamId && !room.deletedAt && room.hostUserId === userId);
  if (retainedHostedRoom) {
    sendRelayError(res, 409, "conflict", "Reassign room host authority before removing this team member.", {
      roomId: retainedHostedRoom.id
    });
    return;
  }

  const team = store.getTeam(teamId);
  if (!team) return void sendRelayError(res, 404, "team_not_found", "Team not found");
  const previousMembers = new Map(members);
  const scrubbedRooms = deletedRoomsHostedBy(store, teamId, userId);
  const inviteArtifacts = snapshotTeamInviteArtifacts(store, teamId);
  try {
    scrubDeletedRoomHostIdentity(store, scrubbedRooms);
    const updatedMembers = new Map(members);
    updatedMembers.delete(userId);
    store.setTeamMembers(teamId, updatedMembers);
    store.setTeam({ ...team, members: updatedMembers.size });
    revokeTeamInvites(teamId);
    scheduleStoreSave();
  } catch {
    store.setTeamMembers(teamId, previousMembers);
    store.setTeam(team);
    for (const room of scrubbedRooms) store.setRoom(room);
    restoreTeamInviteArtifacts(store, inviteArtifacts);
    return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist team member removal.");
  }
  revokeTeamMemberSessions(teamId, userId);
  options.broadcastWorkspaceUpdated(store.getTeam(teamId)!);
  res.json({ members: listTeamMembers(teamId, store, options.teamRoleRank) });
}

interface TeamInviteArtifactSnapshot {
  invites: Map<string, RelayStore["invites"] extends Map<string, infer Value> ? Value : never>;
  requests: Map<string, RelayStore["inviteRequests"] extends Map<string, infer Value> ? Value : never>;
  responses: Map<string, RelayStore["inviteResponses"] extends Map<string, infer Value> ? Value : never>;
  receipts: Map<string, RelayStore["inviteAckReceipts"] extends Map<string, infer Value> ? Value : never>;
}

function snapshotTeamInviteArtifacts(store: RelayStore, teamId: string): TeamInviteArtifactSnapshot {
  const invites = new Map(Array.from(store.invites).filter(([, invite]) => invite.teamId === teamId));
  const inviteIds = new Set(invites.keys());
  return {
    invites,
    requests: new Map(Array.from(store.inviteRequests).filter(([, request]) => inviteIds.has(request.inviteId))),
    responses: new Map(Array.from(store.inviteResponses).filter(([, response]) => inviteIds.has(response.inviteId))),
    receipts: new Map(Array.from(store.inviteAckReceipts).filter(([, receipt]) => inviteIds.has(receipt.inviteId)))
  };
}

function restoreTeamInviteArtifacts(store: RelayStore, snapshot: TeamInviteArtifactSnapshot): void {
  for (const [id, invite] of snapshot.invites) store.invites.set(id, invite);
  for (const [id, request] of snapshot.requests) store.inviteRequests.set(id, request);
  for (const [id, response] of snapshot.responses) store.inviteResponses.set(id, response);
  for (const [id, receipt] of snapshot.receipts) store.inviteAckReceipts.set(id, receipt);
}

function deletedRoomsHostedBy(store: RelayStore, teamId: string, userId: string): RoomRecord[] {
  return store
    .allRooms()
    .filter((room) => room.teamId === teamId && Boolean(room.deletedAt) && room.hostUserId === userId);
}

function scrubDeletedRoomHostIdentity(store: RelayStore, rooms: RoomRecord[]): void {
  for (const room of rooms) {
    const { hostUserId: _hostUserId, activeHostDeviceId: _activeHostDeviceId, ...withoutHostIdentity } = room;
    store.setRoom({ ...withoutHostIdentity, host: "Former member", hostStatus: "offline" });
  }
}

interface TeamCreationRequest {
  session: AuthSession | null;
  name: string;
  res: Response;
}

async function createTeamWithinAccountTurn(
  { session, name, res }: TeamCreationRequest,
  {
    store,
    saveRelayStore,
    scheduleStoreSave,
    broadcastWorkspaceUpdated,
    recordQuotaRejection,
    recordCapacityRejection,
    dailyCreationCaps
  }: RegisterTeamRoutesOptions
): Promise<void> {
  const teamsPerUser = dailyCreationCaps?.teamsPerUser ?? 25;
  const releaseQuotaTransaction = await acquireDurableQuotaTransaction(store);
  try {
    // A restriction, logout, or deletion can revoke this exact session while
    // this request waits behind an unrelated durable-quota write.
    if (session && !isLiveAccountSession(store, session)) {
      sendRelayError(res, 401, "authentication_required", "Sign in before creating a team.");
      return;
    }
    const reservation = session
      ? reserveDurableQuota({
          store,
          quota: "daily_team_creations",
          userId: session.user.id,
          limit: teamsPerUser,
          resetAt: nextUtcMidnight(Date.now())
        })
      : null;
    if (reservation && !reservation.allowed) {
      recordQuotaRejection?.("daily_user_team_creations");
      sendTeamCreationQuotaExceeded(res, reservation, teamsPerUser);
      return;
    }

    const team: TeamRecord = { id: `team_${nanoid(10)}`, name, members: session ? 1 : 0 };
    try {
      store.setTeam(team);
      if (session) {
        store.setTeamMembers(
          team.id,
          new Map<string, TeamMemberRecord>([
            [
              session.user.id,
              { teamId: team.id, userId: session.user.id, role: "owner", joinedAt: new Date().toISOString() }
            ]
          ])
        );
        await saveRelayStore();
      } else {
        scheduleStoreSave();
      }
    } catch (error) {
      store.teams.delete(team.id);
      store.teamMembers.delete(team.id);
      if (reservation?.allowed) rollbackDurableQuota(store, reservation);
      if (error instanceof RelayStoreCapacityError) {
        recordCapacityRejection?.("durable_entries", error.teamId ? "team" : "relay");
        sendRelayCapacityError(res, error);
        return;
      }
      sendRelayError(res, 503, "persistence_unavailable", "Could not persist team quota and team.");
      return;
    }

    broadcastWorkspaceUpdated(team);
    res.status(201).json({ team: teamRecordForUser(store.getTeam(team.id) ?? team, store, session?.user.id) });
  } finally {
    releaseQuotaTransaction();
  }
}

function sendTeamCreationQuotaExceeded(
  res: Response,
  reservation: { allowed: false; used: number; resetAt: number },
  teamsPerUser: number
): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  sendRelayError(res, 429, "quota_exceeded", "Daily team creation quota exceeded.", {
    retryAfterSeconds,
    quota: {
      type: "daily_user_team_creations",
      limit: teamsPerUser,
      used: reservation.used,
      remaining: 0,
      resetsAt: new Date(reservation.resetAt).toISOString()
    }
  });
}

function listTeamMembers(
  teamId: string,
  store: RelayStore,
  teamRoleRank: (role: TeamRole) => number
): TeamMemberRecord[] {
  return Array.from(store.getTeamMembers(teamId)?.values() ?? []).sort(
    (a, b) => teamRoleRank(a.role) - teamRoleRank(b.role) || a.userId.localeCompare(b.userId)
  );
}

type TeamLifecycleAction = "archive" | "restore" | "delete";

function isTeamLifecycleAction(value: string): value is TeamLifecycleAction {
  return value === "archive" || value === "restore" || value === "delete";
}

function teamLifecycleAuthorizationError(action: TeamLifecycleAction, role: TeamRole | undefined): string | null {
  if (action === "delete") return role === "owner" ? null : "Only the team owner can delete a team.";
  return role === "owner" || role === "admin" ? null : "Only team owners and admins can archive or restore teams.";
}

function teamAfterLifecycleAction(team: TeamRecord, action: TeamLifecycleAction, now: string): TeamRecord {
  if (action === "restore") return { ...team, archivedAt: undefined };
  if (action === "archive") return { ...team, archivedAt: team.archivedAt ?? now };
  return { ...team, archivedAt: undefined, deletedAt: now };
}

function roomAfterTeamLifecycleAction(room: RoomRecord, action: TeamLifecycleAction, now: string): RoomRecord {
  if (action === "restore") return { ...room, archivedAt: undefined };
  if (action === "archive") return { ...room, archivedAt: room.archivedAt ?? now };
  return { ...room, archivedAt: undefined, deletedAt: now };
}

export function teamRecordForUser(
  team: TeamRecord,
  store: Pick<RelayStore, "getTeamMember">,
  userId?: string
): TeamRecord {
  const role = userId ? store.getTeamMember(team.id, userId)?.role : undefined;
  return role ? { ...team, role } : team;
}

function parseRequestedTeamRole(value: unknown): TeamRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}
