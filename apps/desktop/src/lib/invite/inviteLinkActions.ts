import { encodeRoomInviteSecret } from "@multaiplayer/crypto";
import { exportRoomSecret } from "../localHistory";
import { createInvite } from "../workspaceClient";
import { displayableInviteLink } from "../invitePrivacy";
import { canCreateRoomInvite } from "../invitePolicy";
import { shouldApplyRoomScopedUiUpdate } from "../roomScopedUi";
import { roomLockMessage } from "../appRuntime";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import {
  encodeNoSecretRoomInvite,
  jsonWebKeyToDevicePublicKeyJwk
} from "../noSecretRoomInvite";
import type { UseInviteActionsOptions } from "./inviteActionTypes";
import { currentLocalIdentity, currentSelectedRoom } from "../selectedWorkspace";

type InviteLinkActionOptions = Pick<
  UseInviteActionsOptions,
  | "selectedRoomIdRef"
>;

type InviteLinkStore = Pick<AppStoreState, "setInviteLinkForRoom" | "setInviteMessageForRoom">;

export function createInviteLinkActions(
  options: InviteLinkActionOptions,
  store: InviteLinkStore = useAppStore.getState()
) {
  const {
    selectedRoomIdRef
  } = options;
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
    const inviteApprovalGate = appStore.inviteByRoom[selectedRoom.id]?.approvalGate ?? false;
    if (isSelectedRoomLocked) {
      setSelectedInviteMessage(roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    const roomId = selectedRoom.id;
    if (!canCreateRoomInvite(selectedRoom, localUser, false, inviteApprovalGate)) {
      setInviteMessageForRoom(roomId, "Only the active host can create approval-gated invite links.");
      return;
    }
    setInviteMessageForRoom(roomId, null);
    setInviteLinkForRoom(roomId, "");
    try {
      const invite = await createInvite(selectedRoom.teamId, roomId);
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${invite.id}`;
      if (inviteApprovalGate) {
        if (!deviceIdentity) {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(roomId, "Device identity is still being prepared. Try again in a moment.");
          }
          return;
        }
        const fragment = encodeNoSecretRoomInvite({
          version: 1,
          teamId: selectedRoom.teamId,
          roomId,
          roomName: selectedRoom.name,
          hostDeviceId: deviceId,
          hostPublicKeyJwk: jsonWebKeyToDevicePublicKeyJwk(deviceIdentity.publicKeyJwk),
          hostPublicKeyFingerprint: deviceIdentity.publicKeyFingerprint
        });
        const link = `${inviteUrl}#multaiplayerJoin=${fragment}&approval=request`;
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteLinkForRoom(roomId, displayableInviteLink(link, false));
        }
        try {
          await navigator.clipboard.writeText(link);
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(
              roomId,
              "Copied approval invite link. The host will approve access when someone joins."
            );
          }
        } catch {
          if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
            setInviteMessageForRoom(
              roomId,
              "Approval invite generated. Copying was blocked because the app was not focused."
            );
          }
        }
        return;
      }

      const fragment = encodeRoomInviteSecret({
        version: 1,
        teamId: selectedRoom.teamId,
        roomId,
        roomName: selectedRoom.name,
        secret: await exportRoomSecret(roomId)
      });
      const link = `${inviteUrl}#multaiplayerInvite=${fragment}`;
      if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
        setInviteLinkForRoom(roomId, displayableInviteLink(link, true));
      }
      try {
        await navigator.clipboard.writeText(link);
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(
            roomId,
            "Copied direct invite link. It grants room access, so it is not displayed after copying."
          );
        }
      } catch {
        if (shouldApplyRoomScopedUiUpdate(selectedRoomIdRef.current, roomId)) {
          setInviteMessageForRoom(
            roomId,
            "Direct invite generated, but copying was blocked. Focus the app and try again, or use host approval."
          );
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
