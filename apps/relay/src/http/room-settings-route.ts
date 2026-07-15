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
    const {
      name,
      approvalPolicy,
      approvalDelegationPolicy,
      trustedApproverUserIds,
      mode,
      browserAllowedOrigins,
      browserProfilePersistent,
      normalizedBrowserAllowedOrigins
    } = normalizeRoomSettingsInput(req.body, {
      normalizeMetadataText,
      normalizeBrowserAllowedOrigins,
      maxRoomNameChars,
      maxUserIdChars
    });
    const requester = requesterFromRequest(req.body, req.cookies?.multaiplayer_session);
    const room = store.getRoom(roomId);
    if (!room) return void sendRelayError(res, 404, "room_not_found", "Room not found");
    if (roomSettingsUnavailable(room, store.getTeam(room.teamId)))
      return void sendRelayError(res, 409, "conflict", "Restore this room before changing room settings.");
    if (session && !canAccessRoom(room.teamId, room.id, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this room before changing room settings.");
    if (room.hostStatus === "active" && !isRoomHost(room, requester))
      return void sendRelayError(res, 403, "forbidden", "Only the active host can change room settings.");
    const inputError = roomSettingsInputError(
      req.body,
      {
        name,
        approvalPolicy,
        approvalDelegationPolicy,
        trustedApproverUserIds,
        mode,
        browserAllowedOrigins,
        browserProfilePersistent,
        normalizedBrowserAllowedOrigins
      },
      options
    );
    if (inputError) return void sendRelayError(res, 400, "invalid_request", inputError);

    const validApprovalPolicy = approvalPolicy as RoomRecord["approvalPolicy"] | undefined;
    const validApprovalDelegationPolicy = approvalDelegationPolicy as
      RoomRecord["approvalDelegationPolicy"] | undefined;
    const validMode = mode as RoomRecord["mode"] | undefined;
    const validBrowserProfilePersistent = browserProfilePersistent as boolean | undefined;

    const updated: RoomRecord = {
      ...room,
      name: name ?? room.name,
      approvalPolicy: validApprovalPolicy ?? room.approvalPolicy,
      approvalDelegationPolicy: validApprovalDelegationPolicy ?? room.approvalDelegationPolicy,
      trustedApproverUserIds: trustedApproverUserIds ?? room.trustedApproverUserIds,
      mode: validMode ?? room.mode,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins ?? room.browserAllowedOrigins,
      browserProfilePersistent: validBrowserProfilePersistent ?? room.browserProfilePersistent
    };
    store.setRoom(updated);
    scheduleStoreSave();
    broadcastRoomUpdated(updated);
    res.json({ room: updated });
  });
}

function roomSettingsInputError(
  body: Record<string, unknown> | undefined,
  input: ReturnType<typeof normalizeRoomSettingsInput>,
  options: RegisterRoomRoutesOptions
): string | null {
  if (body?.name !== undefined && !input.name) {
    return `Room name is required and must be up to ${options.maxRoomNameChars} characters`;
  }
  if (input.approvalPolicy !== undefined && !options.isApprovalPolicy(input.approvalPolicy)) {
    return "approvalPolicy is invalid";
  }
  if (
    input.approvalDelegationPolicy !== undefined &&
    !options.isApprovalDelegationPolicy(input.approvalDelegationPolicy)
  ) {
    return "approvalDelegationPolicy is invalid";
  }
  if (input.trustedApproverUserIds === null) return "trustedApproverUserIds must be up to 50 user ids";
  if (input.mode !== undefined && !options.isRoomMode(input.mode)) {
    return "mode must include boolean chat, code, workspace, and browser fields";
  }
  if (input.browserAllowedOrigins !== undefined && input.normalizedBrowserAllowedOrigins === null) {
    return "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com";
  }
  if (input.browserProfilePersistent !== undefined && typeof input.browserProfilePersistent !== "boolean") {
    return "browserProfilePersistent must be a boolean";
  }
  return null;
}

function normalizeRoomSettingsInput(
  body: Record<string, unknown> | undefined,
  options: Pick<
    RegisterRoomRoutesOptions,
    "normalizeMetadataText" | "normalizeBrowserAllowedOrigins" | "maxRoomNameChars" | "maxUserIdChars"
  >
) {
  const name =
    body?.name === undefined ? undefined : options.normalizeMetadataText(body.name, options.maxRoomNameChars);
  const approvalPolicy = body?.approvalPolicy === undefined ? undefined : String(body.approvalPolicy);
  const approvalDelegationPolicy =
    body?.approvalDelegationPolicy === undefined ? undefined : String(body.approvalDelegationPolicy);
  const trustedApproverUserIds =
    body?.trustedApproverUserIds === undefined
      ? undefined
      : normalizeTrustedApproverUserIds(body.trustedApproverUserIds, options.maxUserIdChars);
  const browserAllowedOrigins = body?.browserAllowedOrigins;
  return {
    name,
    approvalPolicy,
    approvalDelegationPolicy,
    trustedApproverUserIds,
    mode: body?.mode,
    browserAllowedOrigins,
    browserProfilePersistent: body?.browserProfilePersistent,
    normalizedBrowserAllowedOrigins:
      browserAllowedOrigins === undefined ? undefined : options.normalizeBrowserAllowedOrigins(browserAllowedOrigins)
  };
}

function roomSettingsUnavailable(
  room: RoomRecord,
  team: { archivedAt?: string | undefined; deletedAt?: string | undefined } | undefined
) {
  return Boolean(room.archivedAt || room.deletedAt || team?.archivedAt || team?.deletedAt);
}
