import {
  DevicePublicKeyJwk,
  type RelayEnvelope,
  type RoomKeyRotationPlaintextPayload,
  type RoomRecord
} from "@multaiplayer/protocol";
import {
  createRoomSecret,
  encryptJson,
  fingerprintPublicKey,
  sameDevicePublicKey,
  wrapRoomSecretAuthenticatedForDevice
} from "@multaiplayer/crypto";
import {
  clearPendingRoomRotation,
  installRoomSecretEpoch,
  loadOrCreateCurrentRoomKey,
  loadPendingRoomRotation,
  savePendingRoomRotation,
  type PendingRoomKeyRotation
} from "../localHistory";
import { loadPinnedInviteDeviceKey } from "../inviteCapabilityStore";
import { isDeviceKeyTrusted } from "../deviceTrust";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { formatMessageTime } from "../appFormatters";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentSelectedRoomContext } from "../selectedWorkspace";
import { loadTeamDevices, revokeRoomInvites } from "../workspaceClient";

type RoomKeyRotationActionOptions = Pick<
  UseInviteActionsOptions,
  "historyLoadedRoomIds" | "relayRef" | "reportRoomKeyRotationInFlight" | "seenEnvelopeIds" | "selectedRoomIdRef"
>;

type RoomKeyRotationStore = Pick<
  AppStoreState,
  | "appendRoomMessage"
  | "restoreForgottenRoom"
  | "setInviteLinkForRoom"
  | "setInviteMessageForRoom"
  | "setKeyRotationBusyForRoom"
>;

export function createRoomKeyRotationActions(
  options: RoomKeyRotationActionOptions,
  store: RoomKeyRotationStore = useAppStore.getState()
) {
  const { historyLoadedRoomIds, relayRef, reportRoomKeyRotationInFlight, seenEnvelopeIds, selectedRoomIdRef } = options;
  const {
    appendRoomMessage,
    restoreForgottenRoom,
    setInviteLinkForRoom,
    setInviteMessageForRoom,
    setKeyRotationBusyForRoom
  } = store;
  const setSelectedInviteMessage = (message: string | null) =>
    setInviteMessageForRoom(selectedRoomIdRef.current, message);

  async function rotateRoomKeyForDevices(
    room: RoomRecord,
    actor: { id: string; name: string },
    deviceId: string,
    excludedUserIds: ReadonlySet<string> = new Set()
  ) {
    if (reportRoomKeyRotationInFlight(room.id)) throw new Error("Room key rotation is already in progress.");
    const appStore = useAppStore.getState();
    const client = relayRef.current;
    if (!client || appStore.relayStatus === "closed" || appStore.relayStatus === "error") {
      throw new Error("The relay must be connected before room access can be rotated.");
    }
    const hostIdentity = appStore.deviceIdentity;
    if (!hostIdentity) throw new Error("The active host device has no key identity.");
    setKeyRotationBusyForRoom(room.id, true);
    try {
      const finishPendingRotation = async (pending: PendingRoomKeyRotation) => {
        await client.publishAndWaitForAck({ type: "publish", envelope: pending.envelope });
        if (!pending.installed) {
          await installRoomSecretEpoch(room.id, pending.payload.newEpoch, pending.newSecret);
          pending.installed = true;
          await savePendingRoomRotation(room.id, pending);
        }
        await revokeRoomInvites(room.teamId, room.id);
        historyLoadedRoomIds.current.add(room.id);
        appendRoomMessage(room.id, {
          id: pending.payload.id,
          author: "multAIplayer",
          role: "system",
          body: `${pending.payload.rotatedBy} refreshed room access. Future messages and invites use the updated access state.`,
          time: formatMessageTime(pending.payload.rotatedAt),
          createdAt: pending.payload.rotatedAt
        });
        restoreForgottenRoom(room.id);
        setInviteLinkForRoom(room.id, "");
        setInviteMessageForRoom(room.id, "Refreshed room access for future messages and invites.");
        await clearPendingRoomRotation(room.id, pending.payload.id);
        return {
          previousEpoch: pending.payload.previousEpoch,
          newEpoch: pending.payload.newEpoch,
          recipientCount: pending.payload.recipients.length
        };
      };
      const devices = (await loadTeamDevices(room.teamId)).filter((device) => !excludedUserIds.has(device.userId));
      if (devices.length === 0)
        throw new Error("No remaining registered team devices are available for room-key rotation.");
      const pending = await loadPendingRoomRotation(room.id);
      if (pending) {
        const currentRecipients = new Set(
          devices.map((device) => `${device.userId}\u0000${device.deviceId}\u0000${device.publicKeyFingerprint}`)
        );
        const pendingRecipients = new Set(
          pending.payload.recipients.map(
            (recipient) => `${recipient.userId}\u0000${recipient.deviceId}\u0000${recipient.publicKeyFingerprint}`
          )
        );
        const exactRecipientScope =
          currentRecipients.size === pendingRecipients.size &&
          [...currentRecipients].every((recipient) => pendingRecipients.has(recipient));
        if (exactRecipientScope) return await finishPendingRotation(pending);
        // A roster/removal intent change invalidates the unpublished retry record. Never deliver
        // stale wrapped material to the broader set; build a fresh random key for the current set.
        await clearPendingRoomRotation(room.id, pending.payload.id);
      }
      const { epoch: previousEpoch, secret: oldSecret } = await loadOrCreateCurrentRoomKey(room.id);
      const newEpoch = previousEpoch + 1;
      // Each epoch has independent CSPRNG material. Retry idempotency comes from the complete
      // pending rotation persisted before publish, not from derivation using older secrets.
      const newSecret = await createRoomSecret();
      const rotatedAt = new Date().toISOString();
      const rotationId = crypto.randomUUID();
      const verifiedDevices: typeof devices = [];
      const rejectedDevices: string[] = [];
      for (const device of devices) {
        const key = DevicePublicKeyJwk.parse(device.publicKeyJwk);
        const computedFingerprint = await fingerprintPublicKey(key);
        const selfVerified =
          device.userId === actor.id &&
          device.deviceId === deviceId &&
          computedFingerprint === hostIdentity.publicKeyFingerprint &&
          sameDevicePublicKey(key, hostIdentity.publicKeyJwk);
        const pin = loadPinnedInviteDeviceKey(room.id, device.userId, device.deviceId);
        const pinnedKey = DevicePublicKeyJwk.safeParse(pin?.jwk);
        const capabilityVerified =
          pin?.fingerprint === computedFingerprint && pinnedKey.success && sameDevicePublicKey(key, pinnedKey.data);
        const manuallyVerified = isDeviceKeyTrusted(
          appStore.trustedDeviceKeys,
          room.id,
          device.deviceId,
          computedFingerprint
        );
        if (
          device.publicKeyFingerprint !== computedFingerprint ||
          (!selfVerified && !capabilityVerified && !manuallyVerified)
        ) {
          rejectedDevices.push(`${device.userId}/${device.deviceId}`);
        } else {
          verifiedDevices.push({ ...device, publicKeyJwk: key, publicKeyFingerprint: computedFingerprint });
        }
      }
      if (rejectedDevices.length > 0) {
        throw new Error(`Room-key rotation blocked by unverified device keys: ${rejectedDevices.join(", ")}`);
      }
      const recipients = await Promise.all(
        verifiedDevices.map(async (device) => ({
          userId: device.userId,
          deviceId: device.deviceId,
          publicKeyFingerprint: device.publicKeyFingerprint,
          wrappedRoomSecret: await wrapRoomSecretAuthenticatedForDevice(newSecret, hostIdentity, device.publicKeyJwk, {
            purpose: "room-key-rotation",
            teamId: room.teamId,
            roomId: room.id,
            senderUserId: actor.id,
            senderDeviceId: deviceId,
            recipientDeviceId: device.deviceId,
            operationId: rotationId,
            keyEpoch: previousEpoch,
            previousEpoch,
            newEpoch
          })
        }))
      );
      const payload: RoomKeyRotationPlaintextPayload = {
        eventType: "room.key.rotated",
        id: rotationId,
        rotatedBy: actor.name,
        rotatedByUserId: actor.id,
        rotatedAt,
        previousEpoch,
        newEpoch,
        recipients,
        note: "Future room messages and invites use this key."
      };
      const metadata = {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: deviceId,
        senderUserId: actor.id,
        createdAt: rotatedAt,
        kind: "room.key",
        keyEpoch: previousEpoch
      } as const;
      const envelope: RelayEnvelope = { ...metadata, payload: await encryptJson(payload, oldSecret, metadata) };
      seenEnvelopeIds.current.add(envelope.id);
      const nextPending: PendingRoomKeyRotation = { envelope, payload, newSecret, installed: false };
      await savePendingRoomRotation(room.id, nextPending);
      return await finishPendingRotation(nextPending);
    } finally {
      setKeyRotationBusyForRoom(room.id, false);
    }
  }

  async function rotateSelectedRoomKey() {
    const context = currentSelectedRoomContext();
    if (!context) {
      setSelectedInviteMessage("Create or join a room before refreshing room access.");
      return;
    }
    const { room: selectedRoom, isActiveHost, hostGateMessage, localUser, deviceId } = context;
    const appStore = useAppStore.getState();
    const isSelectedRoomRevoked =
      appStore.revokedRoomIds.has(selectedRoom.id) || appStore.revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || appStore.forgottenRoomIds.has(selectedRoom.id) || isSelectedRoomRevoked;
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
      `Refresh room access for ${selectedRoom.name}?\n\n` +
        "This updates future messages and invites for current members. " +
        "It is not full member removal in the alpha."
    );
    if (!confirmed) return;

    setInviteMessageForRoom(selectedRoom.id, null);
    try {
      await rotateRoomKeyForDevices(selectedRoom, localUser, deviceId);
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, selectedRoom.id)) {
        setInviteMessageForRoom(selectedRoom.id, String(error));
      }
    }
  }

  return { rotateSelectedRoomKey, rotateRoomKeyForDevices };
}
