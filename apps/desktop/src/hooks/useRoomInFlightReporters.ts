import type { RefObject } from "react";
import { isRoomHostMutationInFlight, roomHostMutationInFlightMessage } from "../lib/hostHandoff";
import { isRoomSettingsMutationInFlight, roomSettingsMutationInFlightMessage } from "../lib/teamRoomDefaults";
import { isRoomKeyRotationInFlight, roomKeyRotationInFlightMessage } from "../lib/roomKeyRotation";
import { isRoomFileActionInFlight, roomFileActionInFlightMessage } from "../lib/workspaceAccess";
import { isRoomTerminalActionInFlight, roomTerminalActionInFlightMessage } from "../lib/terminalApproval";

type RoomBusyRef = RefObject<Record<string, boolean>>;
type RoomMessageSetter = (roomId: string, message: string | null) => void;

interface UseRoomInFlightReportersOptions {
  hostBusyRef: RoomBusyRef;
  settingsBusyRef: RoomBusyRef;
  keyRotationBusyRef: RoomBusyRef;
  fileBusyRef: RoomBusyRef;
  terminalBusyRef: RoomBusyRef;
  setHostMessageForRoom: RoomMessageSetter;
  setSettingsMessageForRoom: RoomMessageSetter;
  setInviteMessageForRoom: RoomMessageSetter;
  setFileMessageForRoom: RoomMessageSetter;
  setTerminalErrorForRoom: RoomMessageSetter;
}

export function useRoomInFlightReporters({
  hostBusyRef,
  settingsBusyRef,
  keyRotationBusyRef,
  fileBusyRef,
  terminalBusyRef,
  setHostMessageForRoom,
  setSettingsMessageForRoom,
  setInviteMessageForRoom,
  setFileMessageForRoom,
  setTerminalErrorForRoom
}: UseRoomInFlightReportersOptions) {
  function reportRoomHostMutationInFlight(roomId: string): boolean {
    if (!isRoomHostMutationInFlight(hostBusyRef.current, roomId)) return false;
    setHostMessageForRoom(roomId, roomHostMutationInFlightMessage());
    return true;
  }

  function reportRoomSettingsMutationInFlight(
    roomId: string,
    setMessage: RoomMessageSetter = setSettingsMessageForRoom
  ): boolean {
    if (!isRoomSettingsMutationInFlight(settingsBusyRef.current, roomId)) return false;
    setMessage(roomId, roomSettingsMutationInFlightMessage());
    return true;
  }

  function reportRoomKeyRotationInFlight(roomId: string): boolean {
    if (!isRoomKeyRotationInFlight(keyRotationBusyRef.current, roomId)) return false;
    setInviteMessageForRoom(roomId, roomKeyRotationInFlightMessage());
    return true;
  }

  function reportRoomFileActionInFlight(roomId: string): boolean {
    if (!isRoomFileActionInFlight(fileBusyRef.current, roomId)) return false;
    setFileMessageForRoom(roomId, roomFileActionInFlightMessage());
    return true;
  }

  function reportRoomTerminalActionInFlight(roomId: string): boolean {
    if (!isRoomTerminalActionInFlight(terminalBusyRef.current, roomId)) return false;
    setTerminalErrorForRoom(roomId, roomTerminalActionInFlightMessage());
    return true;
  }

  return {
    reportRoomHostMutationInFlight,
    reportRoomSettingsMutationInFlight,
    reportRoomKeyRotationInFlight,
    reportRoomFileActionInFlight,
    reportRoomTerminalActionInFlight
  };
}
