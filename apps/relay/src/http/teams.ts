import { sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import type { RoomRecord, TeamMemberRecord, TeamRecord, TeamRole } from "@multaiplayer/protocol";
import { loadRelayConfig } from "../config.js";
import type { AuthSession, RelayStore } from "../state.js";

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
  addTeamMember: (teamId: string, userId: string, role?: TeamRole) => void;
  revokeTeamInvites: (teamId: string) => void;
  revokeTeamMemberSessions: (teamId: string, userId: string) => void;
  broadcastWorkspaceUpdated: (team: TeamRecord) => void;
  broadcastRoomUpdated: (room: RoomRecord) => void;
  scheduleStoreSave: () => void;
  recordQuotaRejection?: (type: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxTeamNameChars: number;
}

const dailyTeamCreationCounts = new Map<string, DailyCreationQuotaRecord>();

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
  addTeamMember,
  revokeTeamInvites,
  revokeTeamMemberSessions,
  broadcastWorkspaceUpdated,
  broadcastRoomUpdated,
  scheduleStoreSave,
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
    if (!["archive", "restore", "delete"].includes(action)) {
      sendRelayError(res, 400, "invalid_request", "action must be archive, restore, or delete");
      return;
    }
    if ((action === "archive" || action === "restore") && requesterRole !== "owner" && requesterRole !== "admin") {
      sendRelayError(res, 403, "forbidden", "Only team owners and admins can archive or restore teams.");
      return;
    }
    if (action === "delete" && requesterRole !== "owner") {
      sendRelayError(res, 403, "forbidden", "Only the team owner can delete a team.");
      return;
    }

    const now = new Date().toISOString();
    const updatedTeam: TeamRecord =
      action === "restore"
        ? { ...team, archivedAt: undefined }
        : action === "archive"
          ? { ...team, archivedAt: team.archivedAt ?? now }
          : { ...team, archivedAt: undefined, deletedAt: now };
    store.setTeam(updatedTeam);

    const updatedRooms: RoomRecord[] = [];
    for (const room of store.allRooms().filter((item) => item.teamId === teamId && !item.deletedAt)) {
      const updatedRoom =
        action === "restore"
          ? { ...room, archivedAt: undefined }
          : action === "archive"
            ? { ...room, archivedAt: room.archivedAt ?? now }
            : { ...room, archivedAt: undefined, deletedAt: now };
      store.setRoom(updatedRoom);
      updatedRooms.push(updatedRoom);
    }

    if (action === "delete") revokeTeamInvites(teamId);
    broadcastWorkspaceUpdated(updatedTeam);
    for (const room of updatedRooms) broadcastRoomUpdated(room);
    scheduleStoreSave();
    res.json({ team: teamRecordForUser(updatedTeam, store, session?.user.id), rooms: updatedRooms });
  });

  app.post("/teams", (req, res) => {
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
    if (
      session &&
      !consumeDailyCreationQuota({
        cap: dailyCreationCaps.teamsPerUser,
        counts: dailyTeamCreationCounts,
        quota: "daily_user_team_creations",
        userId: session.user.id,
        res,
        recordQuotaRejection
      })
    ) {
      return;
    }
    const team: TeamRecord = {
      id: `team_${nanoid(10)}`,
      name,
      members: 1
    };
    store.setTeam(team);
    if (session) {
      addTeamMember(team.id, session.user.id, "owner");
    } else {
      scheduleStoreSave();
      broadcastWorkspaceUpdated(team);
    }
    res.status(201).json({ team: teamRecordForUser(store.getTeam(team.id) ?? team, store, session?.user.id) });
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

interface DailyCreationQuotaRecord {
  count: number;
  resetAt: number;
}

function consumeDailyCreationQuota({
  cap,
  counts,
  quota,
  userId,
  res,
  recordQuotaRejection
}: {
  cap: number;
  counts: Map<string, DailyCreationQuotaRecord>;
  quota: "daily_user_team_creations";
  userId: string;
  res: Response;
  recordQuotaRejection?: (type: string) => void;
}): boolean {
  const now = Date.now();
  const resetAt = nextUtcMidnight(now);
  const key = `${quota}:${userId}`;
  const current = counts.get(key);
  const record = current && current.resetAt > now ? current : { count: 0, resetAt };
  if (record.count >= cap) {
    sendDailyCreationQuotaExceeded(res, {
      quota,
      limit: cap,
      used: record.count,
      resetAt: record.resetAt
    });
    recordQuotaRejection?.(quota);
    return false;
  }
  counts.set(key, { count: record.count + 1, resetAt: record.resetAt });
  return true;
}

function sendDailyCreationQuotaExceeded(
  res: Response,
  {
    quota,
    limit,
    used,
    resetAt
  }: {
    quota: "daily_user_team_creations";
    limit: number;
    used: number;
    resetAt: number;
  }
) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  sendRelayError(res, 429, "quota_exceeded", "Daily team creation quota exceeded.", {
    retryAfterSeconds,
    quota: {
      type: quota,
      limit,
      used,
      remaining: 0,
      resetsAt: new Date(resetAt).toISOString()
    }
  });
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
