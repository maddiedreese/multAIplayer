import type { Express, Response } from "express";
import { nanoid } from "nanoid";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultApprovalDelegationPolicy,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  defaultCodexSpeed,
  defaultRoomMode,
  type ApprovalDelegationPolicy,
  type RoomRecord
} from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";

interface RegisterRoomRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  isTeamMember: (teamId: string, userId: string) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  broadcastRoomUpdated: (room: RoomRecord) => void;
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

export function registerRoomRoutes({
  app,
  store,
  getAuthSession,
  allowMutation,
  isTeamMember,
  canAccessRoom,
  scheduleStoreSave,
  broadcastRoomUpdated,
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
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    if (!store.hasTeam(teamId)) {
      res.status(404).json({ error: "Team not found" });
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
      res.status(400).json({ error: "codexReasoningEffort must be low, medium, high, or xhigh" });
      return;
    }
    if (!codexSpeed) {
      res.status(400).json({ error: "codexSpeed must be standard or fast" });
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
    const projectPath = req.body?.projectPath === undefined ? undefined : normalizeRoomProjectPath(req.body.projectPath);
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
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
      res.status(400).json({ error: "codexReasoningEffort must be low, medium, high, or xhigh" });
      return;
    }
    if (codexSpeed !== undefined && !codexSpeed) {
      res.status(400).json({ error: "codexSpeed must be standard or fast" });
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
      browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? room.browserProfilePersistent
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
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
