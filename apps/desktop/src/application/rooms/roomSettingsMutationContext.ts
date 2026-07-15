import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { useAppStore } from "../../store/appStore";
import { currentSelectedRoom, currentSelectedRoomContext } from "../workspace/selectedWorkspace";
import { omitRecordKey } from "../../lib/core/setUtils";

type CurrentRef<T> = { current: T };

export function createRoomSettingsMutationContext(
  selectedRoomIdRef: CurrentRef<string>,
  settingsBusyRef: CurrentRef<Record<string, boolean>>
) {
  const isCurrentUserActiveHost = () => currentSelectedRoomContext()?.isActiveHost ?? false;
  const currentRoomSettingsGateMessage = () =>
    currentSelectedRoomContext()?.roomSettingsGateMessage ?? "Claim host before changing room host settings.";
  const currentRoomSettingsActor = () => {
    const localUser = currentSelectedRoomContext()?.localUser;
    return { requesterName: localUser?.name ?? "Local user", requesterUserId: localUser?.id ?? "local" };
  };
  const currentRoomAccess = (room: ClientRoomRecord) => {
    const store = useAppStore.getState();
    const revoked = store.revokedRoomIds.has(room.id) || store.revokedTeamIds.has(room.teamId);
    return { revoked, locked: room.archivedAt != null || store.forgottenRoomIds.has(room.id) || revoked };
  };
  const setSettingsBusyForRoom = (roomId: string, busy: boolean) => {
    settingsBusyRef.current = busy
      ? { ...settingsBusyRef.current, [roomId]: true }
      : omitRecordKey(settingsBusyRef.current, roomId);
    useAppStore.getState().setSettingsBusyForRoom(roomId, busy);
  };
  return {
    isCurrentUserActiveHost,
    currentRoomSettingsGateMessage,
    currentRoomSettingsActor,
    currentRoomAccess,
    setSettingsBusyForRoom,
    setSelectedSettingsMessage: (message: string | null) =>
      useAppStore.getState().setSettingsMessageForRoom(selectedRoomIdRef.current, message),
    setSettingsMessageForRoom: (roomId: string, message: string | null) =>
      useAppStore.getState().setSettingsMessageForRoom(roomId, message),
    setSelectedBrowserMessage: (message: string | null) =>
      useAppStore.getState().setBrowserMessageForRoom(selectedRoomIdRef.current, message),
    setBrowserMessageForRoom: (roomId: string, message: string | null) =>
      useAppStore.getState().setBrowserMessageForRoom(roomId, message),
    clearBrowserStatusForRoom: (roomId: string) => useAppStore.getState().clearBrowserStatusForRoom(roomId),
    setProjectPathDraftForRoom: (roomId: string, path: string) =>
      useAppStore.getState().setProjectPathDraftForRoom(roomId, path, currentSelectedRoom()?.projectPath ?? ""),
    resetCodexApprovalForRoom: (roomId: string) => useAppStore.getState().resetCodexApprovalForRoom(roomId),
    resetFileContextForRoom: (roomId: string) => useAppStore.getState().resetFileContextForRoom(roomId)
  };
}

export type RoomSettingsMutationContext = ReturnType<typeof createRoomSettingsMutationContext>;
