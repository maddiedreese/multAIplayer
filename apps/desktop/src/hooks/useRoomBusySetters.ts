import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";

type BusyMap = Record<string, boolean>;

interface UseRoomBusySettersOptions {
  gitWorkflowBusyRef: MutableRefObject<BusyMap>;
  actionsBusyRef: MutableRefObject<BusyMap>;
  localPreviewBusyRef: MutableRefObject<BusyMap>;
  hostBusyRef: MutableRefObject<BusyMap>;
  settingsBusyRef: MutableRefObject<BusyMap>;
  keyRotationBusyRef: MutableRefObject<BusyMap>;
  fileBusyRef: MutableRefObject<BusyMap>;
  terminalBusyRef: MutableRefObject<BusyMap>;
  setGitWorkflowBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setActionsBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setLocalPreviewBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setHostBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setSettingsBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setKeyRotationBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setFileBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
  setTerminalBusyByRoom: Dispatch<SetStateAction<BusyMap>>;
}

function updateBusyMap(current: BusyMap, roomId: string, busy: boolean): BusyMap {
  return busy ? { ...current, [roomId]: true } : omitRecordKey(current, roomId);
}

function setRoomBusy(
  ref: MutableRefObject<BusyMap>,
  setState: Dispatch<SetStateAction<BusyMap>>,
  roomId: string,
  busy: boolean
) {
  ref.current = updateBusyMap(ref.current, roomId, busy);
  setState((current) => updateBusyMap(current, roomId, busy));
}

export function useRoomBusySetters({
  gitWorkflowBusyRef,
  actionsBusyRef,
  localPreviewBusyRef,
  hostBusyRef,
  settingsBusyRef,
  keyRotationBusyRef,
  fileBusyRef,
  terminalBusyRef,
  setGitWorkflowBusyByRoom,
  setActionsBusyByRoom,
  setLocalPreviewBusyByRoom,
  setHostBusyByRoom,
  setSettingsBusyByRoom,
  setKeyRotationBusyByRoom,
  setFileBusyByRoom,
  setTerminalBusyByRoom
}: UseRoomBusySettersOptions) {
  return {
    setGitWorkflowBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(gitWorkflowBusyRef, setGitWorkflowBusyByRoom, roomId, busy),
    setActionsBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(actionsBusyRef, setActionsBusyByRoom, roomId, busy),
    setLocalPreviewBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(localPreviewBusyRef, setLocalPreviewBusyByRoom, roomId, busy),
    setHostBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(hostBusyRef, setHostBusyByRoom, roomId, busy),
    setSettingsBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(settingsBusyRef, setSettingsBusyByRoom, roomId, busy),
    setKeyRotationBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(keyRotationBusyRef, setKeyRotationBusyByRoom, roomId, busy),
    setFileBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(fileBusyRef, setFileBusyByRoom, roomId, busy),
    setTerminalBusyForRoom: (roomId: string, busy: boolean) =>
      setRoomBusy(terminalBusyRef, setTerminalBusyByRoom, roomId, busy)
  };
}
