import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  InviteJoinRequestPlaintextPayload,
  InviteJoinStatusPlaintextPayload,
  RelayEnvelope,
  RoomKeyRotationPlaintextPayload,
  RoomRecord,
  TeamRecord
} from "@multaiplayer/protocol";
import {
  codexModelOptions,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultRoomMode
} from "@multaiplayer/protocol";
import {
  createRoomSecret,
  decodeRoomInviteSecret,
  decryptJson,
  encodeRoomInviteSecret,
  encryptJson,
  openDeviceSealedJson,
  sealJsonToDevice,
  unwrapRoomSecretForDevice,
  wrapRoomSecretForDevice
} from "@multaiplayer/crypto";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import {
  exportRoomSecret,
  importRoomSecret,
  loadOrCreateRoomSecret,
  loadRoomSecret,
  replaceRoomSecret
} from "../lib/localHistory";
import { defaultProjectPath } from "../lib/localBackend";
import { createInvite, lookupInvite } from "../lib/workspaceClient";
import {
  canActOnRoomInviteRequest,
  findRoomInviteRequest,
  roomInviteRequestMessage
} from "../lib/inviteApproval";
import { displayableInviteLink } from "../lib/invitePrivacy";
import { canCreateRoomInvite } from "../lib/invitePolicy";
import { shouldApplyRoomScopedUiUpdate } from "../lib/roomScopedUi";
import { withoutSetValue } from "../lib/setUtils";
import {
  isDeviceSealedPayload,
  isInviteJoinRequestPlaintextPayload,
  isInviteJoinStatusPlaintextPayload
} from "../lib/localRoomHistoryPayload";
import { roomLockMessage } from "../lib/appRuntime";
import {
  decodeNoSecretRoomInvite,
  encodeNoSecretRoomInvite,
  jsonWebKeyToDevicePublicKeyJwk
} from "../lib/noSecretRoomInvite";
import { formatMessageTime } from "../lib/appFormatters";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import type { RelayClient } from "../lib/relayClient";
import type {
  ChatMessage,
  InviteJoinRequest,
  RelayStatus
} from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseInviteActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoom: RoomRecord;
  selectedRoomIdRef: MutableRefObject<string>;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  isActiveHost: boolean;
  hostGateMessage: string;
  inviteApprovalGate: boolean;
  inviteRequests: InviteJoinRequest[];
  inviteSecretInput: string;
  localUser: LocalUser;
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
  relayStatus: RelayStatus;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  reportRoomKeyRotationInFlight: (roomId: string) => boolean;
  upsertTeam: (team: TeamRecord) => void;
  upsertRoom: (room: RoomRecord) => void;
  appendInviteRequest: (roomId: string, request: InviteJoinRequest) => void;
  updateInviteRequestStatus: (roomId: string, requestId: string, status: InviteJoinRequest["status"]) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  setSelectedInviteMessage: (message: string | null) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
  setInviteLinkForRoom: (roomId: string, link: string) => void;
  setInviteSecretInput: Dispatch<SetStateAction<string>>;
  setSelectedTeam: Dispatch<SetStateAction<string>>;
  setSelectedRoomId: Dispatch<SetStateAction<string>>;
  setForgottenRoomIds: Dispatch<SetStateAction<Set<string>>>;
  setRevokedRoomIds: Dispatch<SetStateAction<Set<string>>>;
  setRevokedTeamIds: Dispatch<SetStateAction<Set<string>>>;
  setInviteAdmissionsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setMessagesByRoom: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setKeyRotationBusyForRoom: (roomId: string, busy: boolean) => void;
}

export function useInviteActions({
  hasSelectedRoom,
  selectedRoom,
  selectedRoomIdRef,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  isActiveHost,
  hostGateMessage,
  inviteApprovalGate,
  inviteRequests,
  inviteSecretInput,
  localUser,
  deviceId,
  deviceIdentity,
  relayStatus,
  relayRef,
  seenEnvelopeIds,
  historyLoadedRoomIds,
  reportRoomKeyRotationInFlight,
  upsertTeam,
  upsertRoom,
  appendInviteRequest,
  updateInviteRequestStatus,
  appendRoomMessage,
  setSelectedInviteMessage,
  setInviteMessageForRoom,
  setInviteLinkForRoom,
  setInviteSecretInput,
  setSelectedTeam,
  setSelectedRoomId,
  setForgottenRoomIds,
  setRevokedRoomIds,
  setRevokedTeamIds,
  setInviteAdmissionsByRoom,
  setMessagesByRoom,
  setKeyRotationBusyForRoom
}: UseInviteActionsOptions) {
  async function publishInviteJoinRequest(
    teamId: string,
    roomId: string,
    request: InviteJoinRequestPlaintextPayload,
    recipientPublicKeyJwk?: Record<string, unknown>
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return false;
    const payload = recipientPublicKeyJwk
      ? await sealJsonToDevice(request, recipientPublicKeyJwk)
      : await encryptJson(request, await loadOrCreateRoomSecret(roomId));
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: request.requestedAt,
      kind: "room.invite",
      payload
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    return true;
  }

  async function decryptInviteEnvelope(envelope: RelayEnvelope): Promise<unknown | null> {
    if (deviceIdentity && isDeviceSealedPayload(envelope.payload)) {
      try {
        return await openDeviceSealedJson<unknown>(envelope.payload, deviceIdentity.privateKeyJwk);
      } catch {
        return null;
      }
    }
    if (envelope.payload.algorithm === "AES-GCM-256") {
      const secret = await loadRoomSecret(envelope.roomId);
      if (!secret) {
        setForgottenRoomIds((current) => new Set(current).add(envelope.roomId));
        return null;
      }
      return decryptJson<unknown>(envelope.payload, secret);
    }
    return null;
  }

  async function handleInviteEnvelopePlaintext(roomId: string, plaintext: unknown) {
    if (isInviteJoinRequestPlaintextPayload(plaintext)) {
      appendInviteRequest(roomId, { ...plaintext, status: "pending" });
      return;
    }
    if (!isInviteJoinStatusPlaintextPayload(plaintext)) return;
    updateInviteRequestStatus(roomId, plaintext.requestId, plaintext.status);
    if (!plaintext.requestId.startsWith(`${deviceId}:`)) return;
    if (
      plaintext.status === "approved" &&
      plaintext.wrappedRoomSecret &&
      plaintext.recipientDeviceId === deviceId &&
      deviceIdentity
    ) {
      const unwrappedSecret = await unwrapRoomSecretForDevice(plaintext.wrappedRoomSecret, deviceIdentity.privateKeyJwk);
      await importRoomSecret(roomId, unwrappedSecret);
      setForgottenRoomIds((current) => withoutSetValue(current, roomId));
    }
    if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
      setInviteMessageForRoom(
        roomId,
        plaintext.status === "approved"
          ? plaintext.wrappedRoomSecret
            ? `${plaintext.decidedBy} approved your room join request. This room is unlocked on this device.`
            : `${plaintext.decidedBy} approved your room join request.`
          : `${plaintext.decidedBy} denied your room join request.`
      );
    }
  }

  async function decideInviteJoinRequest(request: InviteJoinRequest, status: InviteJoinRequest["status"]) {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before deciding invite requests.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedInviteMessage(hostGateMessage);
      return;
    }
    if (status === "pending") return;
    const room = selectedRoom;
    const roomRequest = findRoomInviteRequest(inviteRequests, request.id);
    if (!roomRequest || !canActOnRoomInviteRequest(inviteRequests, request.id)) {
      setInviteMessageForRoom(room.id, roomInviteRequestMessage(inviteRequests, request.id));
      return;
    }
    updateInviteRequestStatus(room.id, roomRequest.id, status);
    setInviteMessageForRoom(room.id, `${status === "approved" ? "Approved" : "Denied"} ${roomRequest.requester}'s join request.`);
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") return;
    try {
      const secret = await loadOrCreateRoomSecret(room.id);
      const wrappedRoomSecret = status === "approved" && roomRequest.requesterPublicKeyJwk
        ? await wrapRoomSecretForDevice(secret, roomRequest.requesterPublicKeyJwk)
        : undefined;
      const payload: InviteJoinStatusPlaintextPayload = {
        eventType: "invite.status",
        requestId: roomRequest.id,
        status,
        decidedBy: localUser.name,
        decidedByUserId: localUser.id,
        decidedAt: new Date().toISOString(),
        recipientDeviceId: roomRequest.requesterDeviceId,
        recipientPublicKeyFingerprint: roomRequest.requesterPublicKeyFingerprint,
        wrappedRoomSecret
      };
      const envelopePayload = roomRequest.requesterPublicKeyJwk
        ? await sealJsonToDevice(payload, roomRequest.requesterPublicKeyJwk)
        : await encryptJson(payload, secret);
      const envelope: RelayEnvelope = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: localUser.id,
        createdAt: payload.decidedAt,
        kind: "room.invite",
        payload: envelopePayload
      };
      seenEnvelopeIds.current.add(envelope.id);
      client.publish({ type: "publish", envelope });
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setInviteMessageForRoom(room.id, String(error));
    }
  }

  async function copyInviteLink() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before copying an invite.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const room = selectedRoom;
    const roomId = room.id;
    if (!canCreateRoomInvite(room, localUser, false, inviteApprovalGate)) {
      setInviteMessageForRoom(roomId, "Only the active host can create approval-gated invite links.");
      return;
    }
    setInviteMessageForRoom(roomId, null);
    setInviteLinkForRoom(roomId, "");
    try {
      const invite = await createInvite(room.teamId, room.id);
      if (inviteApprovalGate) {
        if (!deviceIdentity) {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Device identity is still being prepared. Try again in a moment.");
          }
          return;
        }
        const joinFragment = encodeNoSecretRoomInvite({
          version: 1,
          teamId: room.teamId,
          roomId: room.id,
          roomName: room.name,
          hostDeviceId: deviceId,
          hostPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk),
          hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
        });
        const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerJoin=${joinFragment}&approval=request`;
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteLinkForRoom(roomId, displayableInviteLink(link, false));
        }
        try {
          await navigator.clipboard.writeText(link);
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Copied approval invite link. The host will approve access when someone joins.");
          }
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Approval invite generated. Copying was blocked because the app was not focused.");
          }
        }
        return;
      }
      const secret = await exportRoomSecret(room.id);
      const secretFragment = encodeRoomInviteSecret({
        version: 1,
        teamId: room.teamId,
        roomId: room.id,
        roomName: room.name,
        secret
      });
      const link = `${window.location.origin}${window.location.pathname}?invite=${invite.id}#multaiplayerInvite=${secretFragment}`;
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteLinkForRoom(roomId, displayableInviteLink(link, true));
      }
      try {
        await navigator.clipboard.writeText(link);
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Copied direct invite link. It grants room access, so it is not displayed after copying.");
        }
      } catch {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Direct invite generated, but copying was blocked. Focus the app and try again, or use host approval.");
        }
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) setInviteMessageForRoom(roomId, String(error));
    }
  }

  async function rotateSelectedRoomKey() {
    if (!hasSelectedRoom) {
      setSelectedInviteMessage("Create or join a room before refreshing room access.");
      return;
    }
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!isActiveHost) {
      setSelectedInviteMessage(hostGateMessage);
      return;
    }
    if (reportRoomKeyRotationInFlight(selectedRoom.id)) return;
    const confirmed = window.confirm(
      `Refresh room access for ${selectedRoom.name}?\n\nThis updates future messages and invites for current members. It is not full member removal in the alpha.`
    );
    if (!confirmed) return;

    const room = selectedRoom;
    setKeyRotationBusyForRoom(room.id, true);
    setInviteMessageForRoom(room.id, null);
    try {
      const oldSecret = await loadOrCreateRoomSecret(room.id);
      const newSecret = await createRoomSecret();
      const rotatedAt = new Date().toISOString();
      const payload: RoomKeyRotationPlaintextPayload = {
        eventType: "room.key.rotated",
        id: crypto.randomUUID(),
        rotatedBy: localUser.name,
        rotatedByUserId: localUser.id,
        rotatedAt,
        newSecret,
        note: "Future room messages and invites use this key."
      };

      const client = relayRef.current;
      if (client && relayStatus !== "closed" && relayStatus !== "error") {
        const envelope: RelayEnvelope = {
          id: crypto.randomUUID(),
          teamId: room.teamId,
          roomId: room.id,
          senderDeviceId: deviceId,
          senderUserId: localUser.id,
          createdAt: rotatedAt,
          kind: "room.key",
          payload: await encryptJson(payload, oldSecret)
        };
        seenEnvelopeIds.current.add(envelope.id);
        client.publish({ type: "publish", envelope });
      }

      await replaceRoomSecret(room.id, newSecret);
      historyLoadedRoomIds.current.add(room.id);
      appendRoomMessage(room.id, {
        id: payload.id,
        author: "multAIplayer",
        role: "system",
        body: `${localUser.name} refreshed room access. Future messages and invites use the updated access state.`,
        time: formatMessageTime(rotatedAt),
        createdAt: rotatedAt
      });
      setForgottenRoomIds((current) => withoutSetValue(current, room.id));
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) {
        setInviteLinkForRoom(room.id, "");
        setInviteMessageForRoom(
          room.id,
          client && relayStatus !== "closed" && relayStatus !== "error"
            ? "Refreshed room access for future messages and invites."
            : "Refreshed access locally, but the relay is offline. Other members will need a fresh invite."
        );
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, room.id)) setInviteMessageForRoom(room.id, String(error));
    } finally {
      setKeyRotationBusyForRoom(room.id, false);
    }
  }

  async function requestNoSecretInviteAccess(encodedInvite: string, inviteId?: string | null) {
    const inviteSecret = decodeNoSecretRoomInvite(encodedInvite);
    let acceptedRoomName = inviteSecret.roomName;
    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match the no-secret invite fragment.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      setRevokedRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
      setRevokedTeamIds((current) => withoutSetValue(current, inviteSecret.teamId));
      setInviteAdmissionsByRoom((current) => ({
        ...current,
        [inviteSecret.roomId]: inviteId
      }));
    } else {
      upsertTeam({
        id: inviteSecret.teamId,
        name: "Invited team",
        members: 1
      });
      upsertRoom(ensureRoomDefaults({
        id: inviteSecret.roomId,
        teamId: inviteSecret.teamId,
        name: inviteSecret.roomName,
        projectPath: defaultProjectPath,
        host: "No host",
        hostStatus: "offline",
        approvalPolicy: "ask_every_turn",
        mode: defaultRoomMode,
        codexModel: defaultCodexModel,
        browserAllowedOrigins: defaultBrowserAllowedOrigins,
        browserProfilePersistent: defaultBrowserProfilePersistent,
        unread: 0
      }));
    }

    setMessagesByRoom((current) => ({
      ...current,
      [inviteSecret.roomId]: current[inviteSecret.roomId] ?? []
    }));
    setSelectedTeam(inviteSecret.teamId);
    setSelectedRoomId(inviteSecret.roomId);
    setInviteSecretInput("");
    const requestedAt = new Date().toISOString();
    const request: InviteJoinRequest = {
      eventType: "invite.request",
      id: `${deviceId}:${crypto.randomUUID()}`,
      inviteId: inviteId ?? undefined,
      requester: localUser.name,
      requesterUserId: localUser.id,
      requesterDeviceId: deviceId,
      requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk) : undefined,
      requesterPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
      requestedAt,
      note: `Requesting access to ${acceptedRoomName}.`,
      status: "pending"
    };
    appendInviteRequest(inviteSecret.roomId, request);
    const published = await publishInviteJoinRequest(inviteSecret.teamId, inviteSecret.roomId, {
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
    }, inviteSecret.hostPublicKeyJwk);
    setInviteMessageForRoom(inviteSecret.roomId, published
      ? `Requested access to ${acceptedRoomName}. The host needs to approve this device before the room unlocks.`
      : `Imported ${acceptedRoomName} metadata. Send again after the relay reconnects so the host can approve access.`);
  }

  async function acceptInvite(encodedSecret: string, inviteId?: string | null, approvalRequested = false) {
    const inviteSecret = decodeRoomInviteSecret(encodedSecret);
    let acceptedRoomName = inviteSecret.roomName;

    if (inviteId) {
      const metadata = await lookupInvite(inviteId);
      if (metadata.invite.teamId !== inviteSecret.teamId || metadata.invite.roomId !== inviteSecret.roomId) {
        throw new Error("Invite metadata does not match this invite.");
      }
      upsertTeam(metadata.team);
      upsertRoom(ensureRoomDefaults(metadata.room));
      acceptedRoomName = metadata.room.name;
      setRevokedRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
      setRevokedTeamIds((current) => withoutSetValue(current, inviteSecret.teamId));
    } else {
      upsertTeam({
        id: inviteSecret.teamId,
        name: "Invited team",
        members: 1
      });
      upsertRoom(ensureRoomDefaults({
        id: inviteSecret.roomId,
        teamId: inviteSecret.teamId,
        name: inviteSecret.roomName,
        projectPath: defaultProjectPath,
        host: "No host",
        hostStatus: "offline",
        approvalPolicy: "ask_every_turn",
        mode: defaultRoomMode,
        codexModel: defaultCodexModel,
        browserAllowedOrigins: defaultBrowserAllowedOrigins,
        browserProfilePersistent: defaultBrowserProfilePersistent,
        unread: 0
      }));
    }

    await importRoomSecret(inviteSecret.roomId, inviteSecret.secret);
    setForgottenRoomIds((current) => withoutSetValue(current, inviteSecret.roomId));
    if (inviteId) {
      setInviteAdmissionsByRoom((current) => ({
        ...current,
        [inviteSecret.roomId]: inviteId
      }));
    }
    setMessagesByRoom((current) => ({
      ...current,
      [inviteSecret.roomId]: current[inviteSecret.roomId] ?? []
    }));
    setSelectedTeam(inviteSecret.teamId);
    setSelectedRoomId(inviteSecret.roomId);
    setInviteSecretInput("");
    if (approvalRequested) {
      const requestedAt = new Date().toISOString();
      const request: InviteJoinRequest = {
        eventType: "invite.request",
        id: `${deviceId}:${crypto.randomUUID()}`,
        inviteId: inviteId ?? undefined,
        requester: localUser.name,
        requesterUserId: localUser.id,
        requesterDeviceId: deviceId,
        requesterPublicKeyJwk: deviceIdentity ? jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk) : undefined,
        requesterPublicKeyFingerprint: deviceIdentity?.publicKeyFingerprint,
        requestedAt,
        note: `Requesting access to ${acceptedRoomName}.`,
        status: "pending"
      };
      appendInviteRequest(inviteSecret.roomId, request);
      const published = await publishInviteJoinRequest(inviteSecret.teamId, inviteSecret.roomId, {
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
      });
      setInviteMessageForRoom(inviteSecret.roomId, published
        ? `Imported ${acceptedRoomName} and sent a join request to the active host.`
        : `Imported ${acceptedRoomName}. Send again after the relay reconnects so the host can approve access.`);
      return;
    }
    setInviteMessageForRoom(inviteSecret.roomId, `Joined ${acceptedRoomName}.`);
  }

  async function joinInviteSecret() {
    const raw = inviteSecretInput.trim();
    if (!raw) return;
    setSelectedInviteMessage(null);
    setInviteSecretInput("");
    try {
      const [beforeHash, afterHash] = raw.includes("#") ? raw.split("#") : ["", raw];
      const inviteId = beforeHash.includes("?")
        ? new URLSearchParams(beforeHash.split("?").at(-1) ?? "").get("invite")
        : null;
      const fragment = afterHash ?? raw;
      const params = new URLSearchParams(fragment.replace(/^#/, ""));
      const joinInvite = params.get("multaiplayerJoin");
      if (joinInvite) {
        await requestNoSecretInviteAccess(joinInvite, inviteId);
        return;
      }
      const encoded = params.get("multaiplayerInvite") ?? raw;
      await acceptInvite(encoded, inviteId, params.get("approval") === "request");
    } catch (error) {
      setSelectedInviteMessage(`Invite could not be imported: ${String(error)}`);
    }
  }

  return {
    acceptInvite,
    copyInviteLink,
    decryptInviteEnvelope,
    decideInviteJoinRequest,
    handleInviteEnvelopePlaintext,
    joinInviteSecret,
    requestNoSecretInviteAccess,
    rotateSelectedRoomKey
  };
}
