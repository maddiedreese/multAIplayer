import type { RefObject } from "react";
import { isRoomHostMutationInFlight, roomHostMutationInFlightMessage } from "../lib/handoff/hostHandoff";
import { isRoomSettingsMutationInFlight, roomSettingsMutationInFlightMessage } from "../lib/team/teamRoomDefaults";
import { isRoomFileActionInFlight, roomFileActionInFlightMessage } from "../lib/access/workspaceAccess";
import { isRoomTerminalActionInFlight, roomTerminalActionInFlightMessage } from "../lib/terminal/terminalApproval";

type RoomBusyRef = RefObject<Record<string, boolean>>;
type RoomMessageSetter = (roomId: string, message: string | null) => void;

interface UseRoomInFlightReportersOptions {
  hostBusyRef: RoomBusyRef;
  settingsBusyRef: RoomBusyRef;
  membershipCommitBusyRef: RoomBusyRef;
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
  membershipCommitBusyRef,
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

  function reportMembershipCommitInFlight(roomId: string): boolean {
    if (!membershipCommitBusyRef.current[roomId]) return false;
    setInviteMessageForRoom(roomId, "An MLS membership commit is already in progress.");
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
    reportMembershipCommitInFlight,
    reportRoomFileActionInFlight,
    reportRoomTerminalActionInFlight
  };
}
