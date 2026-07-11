import { createInvite } from "../workspaceClient";
import { canCreateRoomInvite } from "../invitePolicy";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import { encodeNoSecretRoomInvite, jsonWebKeyToDevicePublicKeyJwk } from "../noSecretRoomInvite";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoom } from "../selectedWorkspace";
import { loadOrCreateCurrentRoomKey } from "../localHistory";
import { createInviteCapability } from "@multaiplayer/crypto";
import { rememberIssuedInviteCapability } from "../inviteCapabilityStore";

type InviteLinkActionOptions = Pick<UseInviteActionsOptions, "selectedRoomIdRef">;

type InviteLinkStore = Pick<AppStoreState, "setInviteLinkForRoom" | "setInviteMessageForRoom">;

export function createInviteLinkActions(
  options: InviteLinkActionOptions,
  store: InviteLinkStore = useAppStore.getState()
) {
  const { selectedRoomIdRef } = options;
  const { setInviteLinkForRoom, setInviteMessageForRoom } = store;
  const setSelectedInviteMessage = (message: string | null) =>
    setInviteMessageForRoom(selectedRoomIdRef.current, message);

  async function copyInviteLink() {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      setSelectedInviteMessage("Create or join a room before copying an invite.");
      return;
    }
    const appStore = useAppStore.getState();
    const { localUser, deviceId } = currentLocalIdentity();
    const { deviceIdentity } = appStore;
    const isSelectedRoomRevoked =
      appStore.revokedRoomIds.has(selectedRoom.id) || appStore.revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || appStore.forgottenRoomIds.has(selectedRoom.id) || isSelectedRoomRevoked;
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (!canCreateRoomInvite(selectedRoom, localUser, false)) {
      setInviteMessageForRoom(roomId, "Only the active host can create approval-gated invite links.");
      return;
    }
    setInviteMessageForRoom(roomId, null);
    setInviteLinkForRoom(roomId, "");
    try {
      const invite = await createInvite(selectedRoom.teamId, roomId);
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${invite.id}`;
      if (!deviceIdentity) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Device identity is still being prepared. Try again in a moment.");
        }
        return;
      }
      const { epoch: keyEpoch } = await loadOrCreateCurrentRoomKey(roomId);
      const capabilityInvite = {
        version: 3 as const,
        teamId: selectedRoom.teamId,
        roomId,
        roomName: selectedRoom.name,
        inviteCapability: createInviteCapability(),
        keyEpoch,
        hostUserId: localUser.id,
        hostDeviceId: deviceId,
        hostPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk),
        hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
      };
      await rememberIssuedInviteCapability(invite.id, capabilityInvite);
      const fragment = encodeNoSecretRoomInvite(capabilityInvite);
      const link = `${inviteUrl}#multaiplayerJoin=${fragment}&approval=request`;
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteLinkForRoom(roomId, link);
      }
      try {
        await navigator.clipboard.writeText(link);
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Copied invite link. The host will approve access when someone joins.");
        }
      } catch {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Invite generated. Copying was blocked because the app was not focused.");
        }
      }
    } catch (error) {
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteMessageForRoom(roomId, String(error));
      }
    }
  }

  return { copyInviteLink };
}
