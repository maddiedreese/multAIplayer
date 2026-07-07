import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import type {
  TeamMemberRecord,
  TeamRecord,
  TeamRole
} from "@multaiplayer/protocol";
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
  transferTeamOwnership: (members: Map<string, TeamMemberRecord>, nextOwnerUserId: string) => Map<string, TeamMemberRecord>;
  addTeamMember: (teamId: string, userId: string, role?: TeamRole) => void;
  revokeTeamInvites: (teamId: string) => void;
  revokeTeamMemberSessions: (teamId: string, userId: string) => void;
  broadcastWorkspaceUpdated: (team: TeamRecord) => void;
  scheduleStoreSave: () => void;
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
  addTeamMember,
  revokeTeamInvites,
  revokeTeamMemberSessions,
  broadcastWorkspaceUpdated,
  scheduleStoreSave,
  normalizeMetadataText,
  maxTeamNameChars
}: RegisterTeamRoutesOptions) {
  app.get("/teams", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const visibleTeamIds = session ? teamIdsForUser(session.user.id) : new Set(store.allTeams().map((team) => team.id));
    res.json({
      teams: store.allTeams()
        .filter((team) => visibleTeamIds.has(team.id))
        .map((team) => teamRecordForUser(team, store, session?.user.id)),
      rooms: store.allRooms().filter((room) => visibleTeamIds.has(room.teamId))
    });
  });

  app.get("/teams/:teamId/members", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;

    const teamId = String(req.params.teamId ?? "");
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (session && !isTeamMember(teamId, session.user.id)) {
      res.status(403).json({ error: "Join this team before reading its member list." });
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
      res.status(404).json({ error: "Team not found" });
      return;
    }
    if (!role || role === "owner") {
      res.status(400).json({ error: "role must be admin or member" });
      return;
    }
    const members = store.getTeamMembers(teamId);
    const target = store.getTeamMember(teamId, userId);
    if (!members || !target) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
    if (!canSetTeamMemberRole(requesterRole, target.role, role)) {
      res.status(403).json({ error: "Only team owners can change admin roles." });
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
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const members = store.getTeamMembers(teamId);
    const target = store.getTeamMember(teamId, userId);
    if (!members || !target) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
    if (requesterRole !== "owner") {
      res.status(403).json({ error: "Only the current team owner can transfer ownership." });
      return;
    }
    if (session?.user.id && session.user.id === userId) {
      res.status(400).json({ error: "Choose a different team member before transferring ownership." });
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
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const members = store.getTeamMembers(teamId);
    const target = store.getTeamMember(teamId, userId);
    if (!members || !target) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    const requesterRole = session ? store.getTeamMember(teamId, session.user.id)?.role : "owner";
    if (!canRemoveTeamMember(requesterRole, target.role)) {
      res.status(403).json({ error: "Only team owners can remove admins, and owners cannot be removed." });
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

  app.post("/teams", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const name = normalizeMetadataText(req.body?.name, maxTeamNameChars);
    if (!name) {
      res.status(400).json({ error: `Team name is required and must be up to ${maxTeamNameChars} characters` });
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
  return Array.from(store.getTeamMembers(teamId)?.values() ?? [])
    .sort((a, b) => teamRoleRank(a.role) - teamRoleRank(b.role) || a.userId.localeCompare(b.userId));
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
