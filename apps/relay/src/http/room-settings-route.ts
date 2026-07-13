import { sendRelayError } from "./errors.js";
import { codexReasoningEffortIds, type RoomRecord } from "@multaiplayer/protocol";
import {
  normalizeCatalogSelectionPolicy,
  normalizeCodexSandboxLevel,
  normalizeTrustedApproverUserIds
} from "./room-validation.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

const codexReasoningEffortError = `codexReasoningEffort must be one of ${codexReasoningEffortIds.join(", ")}`;

export function registerRoomSettingsRoute(options: RegisterRoomRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowMutation,
    canAccessRoom,
    requesterFromRequest,
    isRoomHost,
    isApprovalPolicy,
    isApprovalDelegationPolicy,
    isRoomMode,
    normalizeMetadataText,
    normalizeRoomProjectPath,
    normalizeCodexModel,
    normalizeCodexReasoningEffort,
    normalizeCodexSpeed,
    normalizeBrowserAllowedOrigins,
    scheduleStoreSave,
    broadcastRoomUpdated,
    maxCodexModelChars,
    maxRoomNameChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  } = options;

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
    const codexModelPolicy = normalizeCatalogSelectionPolicy(req.body?.codexModelPolicy);
    const codexReasoningEffort =
      req.body?.codexReasoningEffort === undefined
        ? undefined
        : normalizeCodexReasoningEffort(req.body.codexReasoningEffort);
    const codexReasoningEffortPolicy = normalizeCatalogSelectionPolicy(req.body?.codexReasoningEffortPolicy);
    const codexSpeed = req.body?.codexSpeed === undefined ? undefined : normalizeCodexSpeed(req.body.codexSpeed);
    const codexServiceTierPolicy = normalizeCatalogSelectionPolicy(req.body?.codexServiceTierPolicy);
    const codexSandboxLevel =
      req.body?.codexSandboxLevel === undefined ? undefined : normalizeCodexSandboxLevel(req.body.codexSandboxLevel);
    const projectPath =
      req.body?.projectPath === undefined ? undefined : normalizeRoomProjectPath(req.body.projectPath);
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room) return void sendRelayError(res, 404, "room_not_found", "Room not found");
    if (
      room.archivedAt ||
      room.deletedAt ||
      store.getTeam(room.teamId)?.archivedAt ||
      store.getTeam(room.teamId)?.deletedAt
    )
      return void sendRelayError(res, 409, "conflict", "Restore this room before changing room settings.");
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this room before changing room settings.");
    if (room.hostStatus === "active" && !isRoomHost(room, requester))
      return void sendRelayError(res, 403, "forbidden", "Only the active host can change room settings.");
    if (req.body?.name !== undefined && !name)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `Room name is required and must be up to ${maxRoomNameChars} characters`
      );
    if (approvalPolicy !== undefined && !isApprovalPolicy(approvalPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalPolicy is invalid");
    if (approvalDelegationPolicy !== undefined && !isApprovalDelegationPolicy(approvalDelegationPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalDelegationPolicy is invalid");
    if (trustedApproverUserIds === null)
      return void sendRelayError(res, 400, "invalid_request", "trustedApproverUserIds must be up to 50 user ids");
    if (mode !== undefined && !isRoomMode(mode))
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "mode must include boolean chat, code, workspace, and browser fields"
      );
    if (codexModel !== undefined && !codexModel)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters`
      );
    if (
      (req.body?.codexModelPolicy !== undefined && !codexModelPolicy) ||
      (req.body?.codexReasoningEffortPolicy !== undefined && !codexReasoningEffortPolicy) ||
      (req.body?.codexServiceTierPolicy !== undefined && !codexServiceTierPolicy)
    )
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Codex catalog selection policies must be auto or pinned"
      );
    if (codexReasoningEffort !== undefined && !codexReasoningEffort)
      return void sendRelayError(res, 400, "invalid_request", codexReasoningEffortError);
    if (codexSpeed !== undefined && !codexSpeed)
      return void sendRelayError(res, 400, "invalid_request", "codexSpeed must be standard or fast");
    if (codexSandboxLevel !== undefined && !codexSandboxLevel)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "codexSandboxLevel must be read_only, workspace_write, workspace_write_network, or danger_full_access"
      );
    if (projectPath !== undefined && !projectPath)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters`
      );
    const normalizedBrowserAllowedOrigins =
      browserAllowedOrigins === undefined ? undefined : normalizeBrowserAllowedOrigins(browserAllowedOrigins);
    if (browserAllowedOrigins !== undefined && normalizedBrowserAllowedOrigins === null)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com"
      );
    if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean")
      return void sendRelayError(res, 400, "invalid_request", "browserProfilePersistent must be a boolean");

    const updated: RoomRecord = {
      ...room,
      name: name ?? room.name,
      projectPath: projectPath ?? room.projectPath,
      approvalPolicy: approvalPolicy ?? room.approvalPolicy,
      approvalDelegationPolicy: approvalDelegationPolicy ?? room.approvalDelegationPolicy,
      trustedApproverUserIds: trustedApproverUserIds ?? room.trustedApproverUserIds,
      mode: mode ?? room.mode,
      codexModel: codexModel ?? room.codexModel,
      codexModelPolicy: codexModelPolicy ?? (codexModel !== undefined ? "pinned" : room.codexModelPolicy),
      codexReasoningEffort: codexReasoningEffort ?? room.codexReasoningEffort,
      codexReasoningEffortPolicy:
        codexReasoningEffortPolicy ?? (codexReasoningEffort !== undefined ? "pinned" : room.codexReasoningEffortPolicy),
      codexSpeed: codexSpeed ?? room.codexSpeed,
      codexServiceTierPolicy:
        codexServiceTierPolicy ?? (codexSpeed !== undefined ? "pinned" : room.codexServiceTierPolicy),
      codexSandboxLevel: codexSandboxLevel ?? room.codexSandboxLevel,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? room.browserProfilePersistent
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}
