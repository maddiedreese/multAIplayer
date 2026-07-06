import type { Dispatch, SetStateAction } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomProjectSettersOptions {
  roomsRef: { current: RoomRecord[] };
  defaultCodexModel: string;
  defaultProjectPath: string;
  setCustomCodexModelsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectPathDraftsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
}

export function useRoomProjectSetters({
  roomsRef,
  defaultCodexModel,
  defaultProjectPath,
  setCustomCodexModelsByRoom,
  setProjectPathDraftsByRoom
}: UseRoomProjectSettersOptions) {
  function setCustomCodexModelForRoom(roomId: string, model: string) {
    const room = roomsRef.current.find((item) => item.id === roomId);
    const currentModel = room?.codexModel ?? defaultCodexModel;
    setCustomCodexModelsByRoom((current) => model === currentModel ? omitRecordKey(current, roomId) : { ...current, [roomId]: model });
  }

  function setProjectPathDraftForRoom(roomId: string, projectPath: string) {
    const room = roomsRef.current.find((item) => item.id === roomId);
    const currentProjectPath = room?.projectPath ?? defaultProjectPath;
    setProjectPathDraftsByRoom((current) => projectPath === currentProjectPath ? omitRecordKey(current, roomId) : { ...current, [roomId]: projectPath });
  }

  return {
    setCustomCodexModelForRoom,
    setProjectPathDraftForRoom
  };
}
