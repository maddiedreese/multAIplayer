import { sendRelayError } from "./errors.js";
import { type RoomRecord } from "@multaiplayer/protocol";
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
    scheduleStoreSave,
    broadcastRoomUpdated,
    maxRoomNameChars
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
    const { name, approvalPolicy, browserProfilePersistent } = normalizeRoomSettingsInput(req.body, {
      normalizeMetadataText,
      maxRoomNameChars
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
        browserProfilePersistent
      },
      options
    );
    if (inputError) return void sendRelayError(res, 400, "invalid_request", inputError);

    const validApprovalPolicy = approvalPolicy as RoomRecord["approvalPolicy"] | undefined;
    const validBrowserProfilePersistent = browserProfilePersistent as boolean | undefined;

    const updated: RoomRecord = {
      ...room,
      name: name ?? room.name,
      approvalPolicy: validApprovalPolicy ?? room.approvalPolicy,
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
  if (input.browserProfilePersistent !== undefined && typeof input.browserProfilePersistent !== "boolean") {
    return "browserProfilePersistent must be a boolean";
  }
  return null;
}

function normalizeRoomSettingsInput(
  body: Record<string, unknown> | undefined,
  options: Pick<RegisterRoomRoutesOptions, "normalizeMetadataText" | "maxRoomNameChars">
) {
  const name =
    body?.name === undefined ? undefined : options.normalizeMetadataText(body.name, options.maxRoomNameChars);
  const approvalPolicy = body?.approvalPolicy === undefined ? undefined : String(body.approvalPolicy);
  return {
    name,
    approvalPolicy,
    browserProfilePersistent: body?.browserProfilePersistent
  };
}

function roomSettingsUnavailable(
  room: RoomRecord,
  team: { archivedAt?: string | undefined; deletedAt?: string | undefined } | undefined
) {
  return Boolean(room.archivedAt || room.deletedAt || team?.archivedAt || team?.deletedAt);
}
