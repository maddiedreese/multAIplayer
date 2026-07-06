import type { Dispatch, SetStateAction } from "react";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomTerminalSettersOptions {
  selectedRoomId: string;
  maxTerminalActivityLines: number;
  setSelectedTerminalIdsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTerminalNamesByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalCommandsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalInputsByRoom: Dispatch<SetStateAction<Record<string, string>>>;
  setTerminalErrorsByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTerminalLinesByRoom: Dispatch<SetStateAction<Record<string, string[]>>>;
}

export function useRoomTerminalSetters({
  selectedRoomId,
  maxTerminalActivityLines,
  setSelectedTerminalIdsByRoom,
  setTerminalNamesByRoom,
  setTerminalCommandsByRoom,
  setTerminalInputsByRoom,
  setTerminalErrorsByRoom,
  setTerminalLinesByRoom
}: UseRoomTerminalSettersOptions) {
  function setSelectedTerminalIdForRoom(roomId: string, terminalId: string | null) {
    setSelectedTerminalIdsByRoom((current) => terminalId ? { ...current, [roomId]: terminalId } : omitRecordKey(current, roomId));
  }

  function setTerminalNameForRoom(roomId: string, name: string) {
    setTerminalNamesByRoom((current) => name === "dev-server" ? omitRecordKey(current, roomId) : { ...current, [roomId]: name });
  }

  function setTerminalCommandForRoom(roomId: string, command: string) {
    setTerminalCommandsByRoom((current) => command === "npm run dev:desktop" ? omitRecordKey(current, roomId) : { ...current, [roomId]: command });
  }

  function setTerminalInputForRoom(roomId: string, input: string) {
    setTerminalInputsByRoom((current) => input ? { ...current, [roomId]: input } : omitRecordKey(current, roomId));
  }

  function setTerminalErrorForRoom(roomId: string, error: string | null) {
    setTerminalErrorsByRoom((current) => error ? { ...current, [roomId]: error } : omitRecordKey(current, roomId));
  }

  function setSelectedTerminalError(error: string | null) {
    setTerminalErrorForRoom(selectedRoomId, error);
  }

  function appendTerminalLinesForRoom(roomId: string, lines: string[]) {
    if (lines.length === 0) return;
    setTerminalLinesByRoom((current) => {
      const roomLines = current[roomId] ?? [];
      return {
        ...current,
        [roomId]: [...roomLines, ...lines].slice(-maxTerminalActivityLines)
      };
    });
  }

  return {
    setSelectedTerminalIdForRoom,
    setTerminalNameForRoom,
    setTerminalCommandForRoom,
    setTerminalInputForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError,
    appendTerminalLinesForRoom
  };
}
