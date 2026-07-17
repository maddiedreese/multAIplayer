import { createInvite } from "../workspace/workspaceClient";
import { canCreateRoomInvite } from "../../lib/invite/invitePolicy";
import { shouldApplyRoomScopedUiUpdate } from "../../lib/room/roomScopedUi";
import { roomLockMessage } from "../runtime/appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import { encodeNoSecretRoomInvite } from "../../lib/invite/noSecretRoomInvite";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoom } from "../workspace/selectedWorkspace";
import { issueMlsInviteCapability } from "../../lib/mls/mlsClient";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

type InviteLinkActionOptions = Pick<UseInviteActionsOptions, "selectedRoomIdRef">;

type InviteLinkStore = Pick<AppStoreState, "setInviteLinkForRoom" | "setInviteMessageForRoom">;

export function createInviteLinkActions(
  options: InviteLinkActionOptions,
  store: InviteLinkStore = useAppStore.getState()
) {
  const { selectedRoomIdRef } = options;
  const { setInviteLinkForRoom, setInviteMessageForRoom } = store;
  const setSelectedInviteMessage = (message: string | null) => {
    const roomId = selectedRoomIdRef.current;
    if (roomId) setInviteMessageForRoom(roomId, message);
  };

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
      if (!deviceIdentity) {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Device identity is still being prepared. Try again in a moment.");
        }
        return;
      }
      const capability = await issueMlsInviteCapability();
      const capabilityInvite = {
        version: 4 as const,
        teamId: selectedRoom.teamId,
        roomId,
        roomName: selectedRoom.name,
        ...capability,
        expiresAt: invite.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        hostUserId: localUser.id,
        hostDeviceId: deviceId,
        hostHpkePublicKey: deviceIdentity.hpkePublicKey!,
        hostHpkeKeyFingerprint: deviceIdentity.hpkeKeyFingerprint
      };
      const fragment = encodeNoSecretRoomInvite(capabilityInvite);
      const link = `https://open.multaiplayer.com/invite#invite=${encodeURIComponent(invite.id)}&multaiplayerJoin=${fragment}&approval=request`;
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteLinkForRoom(roomId, link);
      }
      try {
        await navigator.clipboard.writeText(link);
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(roomId, "Copied invite link. The host will approve access when someone joins.");
        }
      } catch {
        reportExpectedFailure("clipboard write was blocked while generating an invite");
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
