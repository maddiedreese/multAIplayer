import { sendRelayError } from "./errors.js";
import { type RoomRecord } from "@multaiplayer/protocol";
import { normalizeTrustedApproverUserIds } from "./room-validation.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

const encryptedConfigFields = [
  "projectPath",
  "codexModel",
  "codexModelPolicy",
  "codexReasoningEffort",
  "codexReasoningEffortPolicy",
  "codexRawReasoningEnabled",
  "codexSpeed",
  "codexServiceTierPolicy",
  "codexSandboxLevel"
] as const;

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
    normalizeBrowserAllowedOrigins,
    scheduleStoreSave,
    broadcastRoomUpdated,
    maxRoomNameChars,
    maxUserIdChars
  } = options;

  app.patch("/rooms/:roomId/settings", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (encryptedConfigFields.some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field)))
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Host-local room configuration must be published through MLS."
      );
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
      approvalPolicy: approvalPolicy ?? room.approvalPolicy,
      approvalDelegationPolicy: approvalDelegationPolicy ?? room.approvalDelegationPolicy,
      trustedApproverUserIds: trustedApproverUserIds ?? room.trustedApproverUserIds,
      mode: mode ?? room.mode,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? room.browserProfilePersistent
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}
