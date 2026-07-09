import type { InviteJoinRequestPlaintextPayload, RoomRecord } from "@multaiplayer/protocol";
import {
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import { defaultProjectPath } from "./localBackend";
import type { DeviceIdentity } from "./deviceIdentity";
import { jsonWebKeyToDevicePublicKeyJwk } from "./noSecretRoomInvite";
import { ensureRoomDefaults } from "./roomDefaults";
import type { InviteJoinRequest } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

export function buildFallbackInvitedRoom({
  teamId,
  roomId,
  roomName
}: {
  teamId: string;
  roomId: string;
  roomName: string;
}): RoomRecord {
  return ensureRoomDefaults({
    id: roomId,
    teamId,
    name: roomName,
    projectPath: defaultProjectPath,
    host: "No host",
    hostStatus: "offline",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: defaultRoomMode,
    codexModel: defaultCodexModel,
    browserAllowedOrigins: defaultBrowserAllowedOrigins,
    browserProfilePersistent: defaultBrowserProfilePersistent,
    unread: 0
  });
}

export function buildPendingInviteJoinRequest({
  deviceId,
  deviceIdentity,
  inviteId,
  localUser,
  roomName,
  requestedAt = new Date().toISOString()
}: {
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
  inviteId?: string | null;
  localUser: LocalUser;
  roomName: string;
  requestedAt?: string;
}): InviteJoinRequest {
  return {
    eventType: "invite.request",
    id: `${deviceId}:${crypto.randomUUID()}`,
    inviteId: inviteId ?? undefined,
    requester: localUser.name,
    requesterUserId: localUser.id,
    requesterDeviceId: deviceId,
    requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk) : undefined,
    requesterPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
    requestedAt,
    note: `Requesting access to ${roomName}.`,
    status: "pending"
  };
}

export function inviteJoinRequestPlaintext(request: InviteJoinRequest): InviteJoinRequestPlaintextPayload {
  return {
    eventType: request.eventType,
    id: request.id,
    inviteId: request.inviteId,
    requester: request.requester,
    requesterUserId: request.requesterUserId,
    requesterDeviceId: request.requesterDeviceId,
    requesterPublicKeyJwk: request.requesterPublicKeyJwk,
    requesterPublicKeyFingerprint: request.requesterPublicKeyFingerprint,
    requestedAt: request.requestedAt,
    note: request.note
  };
}

export function parseInviteInput(raw: string) {
  const [beforeHash, afterHash] = raw.includes("#") ? raw.split("#") : ["", raw];
  const inviteId = beforeHash.includes("?")
    ? new URLSearchParams(beforeHash.split("?").at(-1) ?? "").get("invite")
    : null;
  const fragment = afterHash ?? raw;
  const params = new URLSearchParams(fragment.replace(/^#/, ""));

  return {
    inviteId,
    joinInvite: params.get("multaiplayerJoin"),
    encodedInvite: params.get("multaiplayerInvite") ?? raw,
    approvalRequested: params.get("approval") === "request"
  };
}
