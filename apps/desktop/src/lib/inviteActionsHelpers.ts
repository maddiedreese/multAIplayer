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
import { computeInviteCapabilityMac, type InviteCapabilityRequestBinding } from "@multaiplayer/crypto";
import type { NoSecretRoomInvite } from "../types";

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

export async function buildPendingInviteJoinRequest({
  deviceId,
  deviceIdentity,
  inviteId,
  localUser,
  roomName,
  capabilityInvite,
  requestedAt = new Date().toISOString()
}: {
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
  inviteId?: string | null;
  localUser: LocalUser;
  roomName: string;
  capabilityInvite: NoSecretRoomInvite;
  requestedAt?: string;
}): Promise<InviteJoinRequest> {
  if (!deviceIdentity || !inviteId) throw new Error("Authenticated device identity and invite id are required");
  const id = `${deviceId}:${crypto.randomUUID()}`;
  const requestNonce = randomNonce();
  const binding: InviteCapabilityRequestBinding = {
    phase: "request",
    inviteId,
    teamId: capabilityInvite.teamId,
    roomId: capabilityInvite.roomId,
    keyEpoch: capabilityInvite.keyEpoch,
    requestId: id,
    requestNonce,
    requesterUserId: localUser.id,
    requesterDeviceId: deviceId,
    requesterPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint,
    hostUserId: capabilityInvite.hostUserId,
    hostDeviceId: capabilityInvite.hostDeviceId,
    hostPublicKeyFingerprint: capabilityInvite.hostPublicKeyFingerprint
  };
  return {
    eventType: "invite.request",
    id,
    inviteId: inviteId ?? undefined,
    requester: localUser.name,
    requesterUserId: localUser.id,
    requesterDeviceId: deviceId,
    requesterPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk),
    requesterPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint,
    hostUserId: capabilityInvite.hostUserId,
    hostDeviceId: capabilityInvite.hostDeviceId,
    hostPublicKeyFingerprint: capabilityInvite.hostPublicKeyFingerprint,
    keyEpoch: capabilityInvite.keyEpoch,
    requestNonce,
    capability: capabilityInvite.inviteCapability,
    capabilityMac: await computeInviteCapabilityMac(capabilityInvite.inviteCapability, binding),
    requestedAt,
    note: `Requesting access to ${roomName}.`,
    status: "pending"
  };
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
    hostUserId: request.hostUserId,
    hostDeviceId: request.hostDeviceId,
    hostPublicKeyFingerprint: request.hostPublicKeyFingerprint,
    keyEpoch: request.keyEpoch,
    requestNonce: request.requestNonce,
    capability: request.capability,
    capabilityMac: request.capabilityMac,
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
  if (params.has("multaiplayerInvite")) {
    throw new Error(
      "This legacy invite contains a room key and is no longer accepted. Ask the active host for a new invite."
    );
  }
  const joinInvite = params.get("multaiplayerJoin");
  if (!joinInvite) {
    throw new Error("Only host-approved multAIplayer invite links are accepted.");
  }

  return {
    inviteId,
    joinInvite
  };
}
