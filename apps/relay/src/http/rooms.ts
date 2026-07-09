import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultApprovalDelegationPolicy,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSandboxLevel,
  defaultCodexSpeed,
  defaultRoomMode,
  codexSandboxLevelOptions,
  type ApprovalDelegationPolicy,
  type RoomRecord
} from "@multaiplayer/protocol";
import { loadRelayConfig } from "../config.js";
import type { AuthSession, RelayStore } from "../state.js";

interface RegisterRoomRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  teamIdsForUser: (userId: string) => Set<string>;
  isTeamMember: (teamId: string, userId: string) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  broadcastRoomUpdated: (room: RoomRecord) => void;
  recordQuotaRejection?: (type: string) => void;
  requesterFromRequest: (body: unknown, sessionId: unknown) => { id: string; name: string };
  isRoomHost: (room: RoomRecord, requester: { id: string; name: string }) => boolean;
  isApprovalPolicy: (value: string) => value is RoomRecord["approvalPolicy"];
  isApprovalDelegationPolicy: (value: string) => value is ApprovalDelegationPolicy;
  isRoomMode: (value: unknown) => value is RoomRecord["mode"];
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeOptionalMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeRoomProjectPath: (value: unknown) => string | null;
  normalizeCodexModel: (value: unknown) => string | null;
  normalizeCodexReasoningEffort: (value: unknown) => RoomRecord["codexReasoningEffort"] | null;
  normalizeCodexSpeed: (value: unknown) => RoomRecord["codexSpeed"] | null;
  normalizeBrowserAllowedOrigins: (value: unknown) => string[] | null;
  displayNameForUser: (user: AuthSession["user"]) => string;
  maxCodexModelChars: number;
  maxHostNameChars: number;
  maxRoomNameChars: number;
  maxRoomProjectPathChars: number;
  maxUserIdChars: number;
}

const dailyRoomCreationCounts = new Map<string, DailyCreationQuotaRecord>();

export function registerRoomRoutes({
  app,
  store,
  getAuthSession,
  allowMutation,
  teamIdsForUser,
  isTeamMember,
  canAccessRoom,
  scheduleStoreSave,
  broadcastRoomUpdated,
  recordQuotaRejection,
  requesterFromRequest,
  isRoomHost,
  isApprovalPolicy,
  isApprovalDelegationPolicy,
  isRoomMode,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRoomProjectPath,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
  normalizeBrowserAllowedOrigins,
  displayNameForUser,
  maxCodexModelChars,
  maxHostNameChars,
  maxRoomNameChars,
  maxRoomProjectPathChars,
  maxUserIdChars
}: RegisterRoomRoutesOptions) {
  const { dailyCreationCaps, totalRoomCapPerUser } = loadRelayConfig();

  app.post("/rooms", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const teamId = String(req.body?.teamId ?? "");
    const name = normalizeMetadataText(req.body?.name, maxRoomNameChars);
    const projectPath = normalizeRoomProjectPath(req.body?.projectPath);
    const approvalPolicy = req.body?.approvalPolicy === undefined ? "ask_every_turn" : String(req.body.approvalPolicy);
    const approvalDelegationPolicy =
      req.body?.approvalDelegationPolicy === undefined
        ? defaultApprovalDelegationPolicy
        : String(req.body.approvalDelegationPolicy);
    const trustedApproverUserIds = normalizeTrustedApproverUserIds(req.body?.trustedApproverUserIds, maxUserIdChars);
    const codexModel = req.body?.codexModel === undefined ? defaultCodexModel : normalizeCodexModel(req.body.codexModel);
    const codexReasoningEffort = req.body?.codexReasoningEffort === undefined
      ? defaultCodexReasoningEffort
      : normalizeCodexReasoningEffort(req.body.codexReasoningEffort);
    const codexSpeed = req.body?.codexSpeed === undefined ? defaultCodexSpeed : normalizeCodexSpeed(req.body.codexSpeed);
    const codexSandboxLevel = req.body?.codexSandboxLevel === undefined
      ? defaultCodexSandboxLevel
      : normalizeCodexSandboxLevel(req.body.codexSandboxLevel);
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    const team = store.getTeam(teamId);
    if (team?.archivedAt || team?.deletedAt) {
      res.status(409).json({ error: "Restore this team before creating rooms." });
      return;
    }
    if (session && !isTeamMember(teamId, session.user.id)) {
      res.status(403).json({ error: "Join this team before creating rooms." });
      return;
    }
    if (!name) {
      res.status(400).json({ error: `Room name is required and must be up to ${maxRoomNameChars} characters` });
      return;
    }
    if (!projectPath) {
      res.status(400).json({ error: `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters` });
      return;
    }
    if (!isApprovalPolicy(approvalPolicy)) {
      res.status(400).json({ error: "approvalPolicy is invalid" });
      return;
    }
    if (!isApprovalDelegationPolicy(approvalDelegationPolicy)) {
      res.status(400).json({ error: "approvalDelegationPolicy is invalid" });
      return;
    }
    if (trustedApproverUserIds === null) {
      res.status(400).json({ error: "trustedApproverUserIds must be up to 50 user ids" });
      return;
    }
    if (!codexModel) {
      res.status(400).json({ error: `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters` });
      return;
    }
    if (!codexReasoningEffort) {
      res.status(400).json({ error: "codexReasoningEffort must be minimal, low, medium, high, or xhigh" });
      return;
    }
    if (!codexSpeed) {
      res.status(400).json({ error: "codexSpeed must be standard or fast" });
      return;
    }
    if (!codexSandboxLevel) {
      res.status(400).json({ error: "codexSandboxLevel must be read_only, workspace_write, workspace_write_network, or danger_full_access" });
      return;
    }
    let normalizedBrowserAllowedOrigins = defaultBrowserAllowedOrigins;
    if (browserAllowedOrigins !== undefined) {
      const parsedBrowserAllowedOrigins = normalizeBrowserAllowedOrigins(browserAllowedOrigins);
      if (parsedBrowserAllowedOrigins === null) {
        res.status(400).json({ error: "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com" });
        return;
      }
      normalizedBrowserAllowedOrigins = parsedBrowserAllowedOrigins;
    }
    if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean") {
      res.status(400).json({ error: "browserProfilePersistent must be a boolean" });
      return;
    }
    if (session && !allowTotalRoomQuota({
      store,
      teamIds: teamIdsForUser(session.user.id),
      cap: totalRoomCapPerUser,
      res,
      recordQuotaRejection
    })) {
      return;
    }
    if (session && !consumeDailyCreationQuota({
      cap: dailyCreationCaps.roomsPerUser,
      counts: dailyRoomCreationCounts,
      quota: "daily_user_room_creations",
      userId: session.user.id,
      res,
      recordQuotaRejection
    })) {
      return;
    }
    const room: RoomRecord = {
      id: `room_${nanoid(10)}`,
      teamId,
      name,
      projectPath,
      host: "No host",
      hostStatus: "offline",
      approvalPolicy,
      approvalDelegationPolicy,
      trustedApproverUserIds,
      mode: defaultRoomMode,
      codexModel,
      codexReasoningEffort,
      codexSpeed,
      codexSandboxLevel,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? defaultBrowserProfilePersistent,
      unread: 0
    };
    store.setRoom(room);
    scheduleStoreSave();
    broadcastRoomUpdated(room);
    res.status(201).json({ room });
  });

  app.patch("/rooms/:roomId/host", (req, res) => {
    const roomId = String(req.params.roomId ?? "");
    const host = normalizeOptionalMetadataText(req.body?.host, maxHostNameChars);
    const requestedHostUserId = normalizeOptionalMetadataText(req.body?.hostUserId, maxUserIdChars);
    const hostStatus = String(req.body?.hostStatus ?? "");
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (host === null || requestedHostUserId === null) {
      res.status(400).json({ error: "Host name and user id must be bounded strings without control characters" });
      return;
    }

    const requester = {
      id: session?.user.id ?? requestedHostUserId,
      name: session ? (normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? "") : host
    };
    const room = store.getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (room.archivedAt || room.deletedAt || store.getTeam(room.teamId)?.archivedAt || store.getTeam(room.teamId)?.deletedAt) {
      res.status(409).json({ error: "Restore this room before changing host state." });
      return;
    }
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id)) {
      res.status(403).json({ error: "Join this room before changing host state." });
      return;
    }
    if (!["active", "offline", "handoff"].includes(hostStatus)) {
      res.status(400).json({ error: "hostStatus must be active, offline, or handoff" });
      return;
    }
    if (!requester.name || !requester.id) {
      res.status(400).json({ error: "Host name and user id are required" });
      return;
    }

    if (hostStatus === "active" && room.hostStatus === "active" && !isRoomHost(room, requester)) {
      res.status(409).json({ error: `${room.host} is already the active host. Ask them to hand off or release the room first.` });
      return;
    }

    if (hostStatus !== "active" && !isRoomHost(room, requester)) {
      res.status(403).json({ error: "Only the active host can hand off or release this room." });
      return;
    }

    const updated: RoomRecord = {
      ...room,
      host: hostStatus === "offline" ? "No host" : hostStatus === "active" ? requester.name : room.host,
      hostUserId: hostStatus === "offline" ? undefined : hostStatus === "active" ? requester.id : room.hostUserId,
      hostStatus: hostStatus as RoomRecord["hostStatus"]
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });

  app.patch("/rooms/:roomId/settings", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const roomId = String(req.params.roomId ?? "");
    const name = req.body?.name === undefined ? undefined : normalizeMetadataText(req.body.name, maxRoomNameChars);
    const approvalPolicy = req.body?.approvalPolicy === undefined ? undefined : String(req.body.approvalPolicy);
    const approvalDelegationPolicy =
      req.body?.approvalDelegationPolicy === undefined ? undefined : String(req.body.approvalDelegationPolicy);
    const trustedApproverUserIds =
      req.body?.trustedApproverUserIds === undefined
        ? undefined
        : normalizeTrustedApproverUserIds(req.body.trustedApproverUserIds, maxUserIdChars);
    const mode = req.body?.mode;
    const codexModel = req.body?.codexModel === undefined ? undefined : normalizeCodexModel(req.body.codexModel);
    const codexReasoningEffort = req.body?.codexReasoningEffort === undefined
      ? undefined
      : normalizeCodexReasoningEffort(req.body.codexReasoningEffort);
    const codexSpeed = req.body?.codexSpeed === undefined ? undefined : normalizeCodexSpeed(req.body.codexSpeed);
    const codexSandboxLevel = req.body?.codexSandboxLevel === undefined
      ? undefined
      : normalizeCodexSandboxLevel(req.body.codexSandboxLevel);
    const projectPath = req.body?.projectPath === undefined ? undefined : normalizeRoomProjectPath(req.body.projectPath);
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (room.archivedAt || room.deletedAt || store.getTeam(room.teamId)?.archivedAt || store.getTeam(room.teamId)?.deletedAt) {
      res.status(409).json({ error: "Restore this room before changing room settings." });
      return;
    }
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id)) {
      res.status(403).json({ error: "Join this room before changing room settings." });
      return;
    }
    if (room.hostStatus === "active" && !isRoomHost(room, requester)) {
      res.status(403).json({ error: "Only the active host can change room settings." });
      return;
    }
    if (req.body?.name !== undefined && !name) {
      res.status(400).json({ error: `Room name is required and must be up to ${maxRoomNameChars} characters` });
      return;
    }
    if (approvalPolicy !== undefined && !isApprovalPolicy(approvalPolicy)) {
      res.status(400).json({ error: "approvalPolicy is invalid" });
      return;
    }
    if (approvalDelegationPolicy !== undefined && !isApprovalDelegationPolicy(approvalDelegationPolicy)) {
      res.status(400).json({ error: "approvalDelegationPolicy is invalid" });
      return;
    }
    if (trustedApproverUserIds === null) {
      res.status(400).json({ error: "trustedApproverUserIds must be up to 50 user ids" });
      return;
    }
    if (mode !== undefined && !isRoomMode(mode)) {
      res.status(400).json({ error: "mode must include boolean chat, code, workspace, and browser fields" });
      return;
    }
    if (codexModel !== undefined && !codexModel) {
      res.status(400).json({ error: `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters` });
      return;
    }
    if (codexReasoningEffort !== undefined && !codexReasoningEffort) {
      res.status(400).json({ error: "codexReasoningEffort must be minimal, low, medium, high, or xhigh" });
      return;
    }
    if (codexSpeed !== undefined && !codexSpeed) {
      res.status(400).json({ error: "codexSpeed must be standard or fast" });
      return;
    }
    if (codexSandboxLevel !== undefined && !codexSandboxLevel) {
      res.status(400).json({ error: "codexSandboxLevel must be read_only, workspace_write, workspace_write_network, or danger_full_access" });
      return;
    }
    if (projectPath !== undefined && !projectPath) {
      res.status(400).json({ error: `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters` });
      return;
    }
    const normalizedBrowserAllowedOrigins = browserAllowedOrigins === undefined
      ? undefined
      : normalizeBrowserAllowedOrigins(browserAllowedOrigins);
    if (browserAllowedOrigins !== undefined && normalizedBrowserAllowedOrigins === null) {
      res.status(400).json({ error: "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com" });
      return;
    }
    if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean") {
      res.status(400).json({ error: "browserProfilePersistent must be a boolean" });
      return;
    }

    const updated: RoomRecord = {
      ...room,
      name: name ?? room.name,
      projectPath: projectPath ?? room.projectPath,
      approvalPolicy: approvalPolicy ?? room.approvalPolicy,
      approvalDelegationPolicy: approvalDelegationPolicy ?? room.approvalDelegationPolicy,
      trustedApproverUserIds: trustedApproverUserIds ?? room.trustedApproverUserIds,
      mode: mode ?? room.mode,
      codexModel: codexModel ?? room.codexModel,
      codexReasoningEffort: codexReasoningEffort ?? room.codexReasoningEffort,
      codexSpeed: codexSpeed ?? room.codexSpeed,
      codexSandboxLevel: codexSandboxLevel ?? room.codexSandboxLevel,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? room.browserProfilePersistent
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });

  app.patch("/rooms/:roomId/lifecycle", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;

    const roomId = String(req.params.roomId ?? "");
    const action = String(req.body?.action ?? "");
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room || room.deletedAt || store.getTeam(room.teamId)?.deletedAt) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id)) {
      res.status(403).json({ error: "Join this room before changing its archive state." });
      return;
    }
    if (!["archive", "restore", "delete"].includes(action)) {
      res.status(400).json({ error: "action must be archive, restore, or delete" });
      return;
    }
    const requesterRole = session ? store.getTeamMember(room.teamId, session.user.id)?.role : "owner";
    const teamAdmin = requesterRole === "owner" || requesterRole === "admin";
    const roomHost = room.hostStatus === "active" && isRoomHost(room, requester);
    if (!teamAdmin && !roomHost) {
      res.status(403).json({ error: "Only the active host or a team owner/admin can archive, restore, or delete a room." });
      return;
    }
    const team = store.getTeam(room.teamId);
    if (action === "restore" && team?.archivedAt) {
      res.status(409).json({ error: "Restore the team before restoring this room." });
      return;
    }

    const now = new Date().toISOString();
    const updated: RoomRecord = action === "restore"
      ? { ...room, archivedAt: undefined }
      : action === "archive"
        ? { ...room, archivedAt: room.archivedAt ?? now }
        : { ...room, archivedAt: undefined, deletedAt: now };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}

function allowTotalRoomQuota({
  store,
  teamIds,
  cap,
  res,
  recordQuotaRejection
}: {
  store: RelayStore;
  teamIds: Set<string>;
  cap: number;
  res: Response;
  recordQuotaRejection?: (type: string) => void;
}): boolean {
  const quota = "total_user_rooms";
  const used = store.allRooms().filter((room) => teamIds.has(room.teamId) && !room.deletedAt).length;
  if (used < cap) return true;
  recordQuotaRejection?.(quota);
  res.status(429).json({
    error: "Total room quota exceeded.",
    code: "quota_exceeded",
    quota: {
      type: quota,
      limit: cap,
      used,
      remaining: 0
    }
  });
  return false;
}

function normalizeCodexSandboxLevel(value: unknown): RoomRecord["codexSandboxLevel"] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return codexSandboxLevelOptions.some((option) => option.id === trimmed)
    ? trimmed as RoomRecord["codexSandboxLevel"]
    : null;
}

function normalizeTrustedApproverUserIds(value: unknown, maxUserIdChars: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || normalized.length > maxUserIdChars || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    ids.add(normalized);
  }
  return [...ids];
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
  quota: "daily_user_room_creations";
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
  { quota, limit, used, resetAt }: {
    quota: "daily_user_room_creations";
    limit: number;
    used: number;
    resetAt: number;
  }
) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  res.status(429).json({
    error: "Daily room creation quota exceeded.",
    code: "quota_exceeded",
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
