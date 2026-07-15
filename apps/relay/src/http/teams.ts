import { sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import type { RoomRecord, TeamMemberRecord, TeamRecord, TeamRole } from "@multaiplayer/protocol";
import { loadRelayConfig } from "../config.js";
import type { AuthSession, RelayStore } from "../state.js";
import { acquireDurableQuotaTransaction, reserveDurableQuota, rollbackDurableQuota } from "../auth/account-quotas.js";

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
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxTeamNameChars: number;
}

export function registerTeamRoutes({
  app,
  store,
  getAuthSession,
  allowRead,
  allowMutation,
  teamIdsForUser,
  isTeamMember,
  teamRoleRank,
  canSetTeamMemberRole,
  canRemoveTeamMember,
  transferTeamOwnership,
  revokeTeamInvites,
  revokeTeamMemberSessions,
  broadcastWorkspaceUpdated,
  broadcastRoomUpdated,
  scheduleStoreSave,
  saveRelayStore,
  recordQuotaRejection,
  normalizeMetadataText,
  maxTeamNameChars
}: RegisterTeamRoutesOptions) {
  const { dailyCreationCaps } = loadRelayConfig();

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

  app.post("/teams/:teamId/members/:userId/transfer-owner", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const userId = String(req.params.userId ?? "");
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

    const updatedMembers = transferTeamOwnership(members, userId);
    const team = store.getTeam(teamId);
    if (team) broadcastWorkspaceUpdated(team);
    scheduleStoreSave();
    res.json({ member: updatedMembers.get(userId), members: listTeamMembers(teamId, store, teamRoleRank) });
  });

  app.delete("/teams/:teamId/members/:userId", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    const userId = String(req.params.userId ?? "");
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

    members.delete(userId);
    const team = store.getTeam(teamId);
    if (team) {
      const updatedTeam = { ...team, members: members.size };
      store.setTeam(updatedTeam);
      revokeTeamInvites(teamId);
      revokeTeamMemberSessions(teamId, userId);
      broadcastWorkspaceUpdated(updatedTeam);
    }
    scheduleStoreSave();
    res.json({ members: listTeamMembers(teamId, store, teamRoleRank) });
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
    broadcastWorkspaceUpdated(updatedTeam);
    for (const room of updatedRooms) broadcastRoomUpdated(room);
    scheduleStoreSave();
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
    const releaseQuotaTransaction = await acquireDurableQuotaTransaction(store);
    try {
      const reservation = session
        ? reserveDurableQuota({
            store,
            quota: "daily_team_creations",
            userId: session.user.id,
            limit: dailyCreationCaps.teamsPerUser,
            resetAt: nextUtcMidnight(Date.now())
          })
        : null;
      if (reservation && !reservation.allowed) {
        recordQuotaRejection?.("daily_user_team_creations");
        res.setHeader("Retry-After", Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000)));
        return void sendRelayError(res, 429, "quota_exceeded", "Daily team creation quota exceeded.", {
          retryAfterSeconds: Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000)),
          quota: {
            type: "daily_user_team_creations",
            limit: dailyCreationCaps.teamsPerUser,
            used: reservation.used,
            remaining: 0,
            resetsAt: new Date(reservation.resetAt).toISOString()
          }
        });
      }
      const team: TeamRecord = {
        id: `team_${nanoid(10)}`,
        name,
        members: 1
      };
      store.setTeam(team);
      if (session) {
        const members = new Map<string, TeamMemberRecord>([
          [
            session.user.id,
            { teamId: team.id, userId: session.user.id, role: "owner", joinedAt: new Date().toISOString() }
          ]
        ]);
        store.setTeamMembers(team.id, members);
        try {
          await saveRelayStore();
        } catch {
          store.teams.delete(team.id);
          store.teamMembers.delete(team.id);
          if (reservation?.allowed) rollbackDurableQuota(store, reservation);
          return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist team quota and team.");
        }
        broadcastWorkspaceUpdated(team);
      } else {
        scheduleStoreSave();
        broadcastWorkspaceUpdated(team);
      }
      res.status(201).json({ team: teamRecordForUser(store.getTeam(team.id) ?? team, store, session?.user.id) });
    } finally {
      releaseQuotaTransaction();
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

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
