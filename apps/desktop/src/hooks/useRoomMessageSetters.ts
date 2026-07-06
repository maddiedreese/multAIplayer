import type { Dispatch, SetStateAction } from "react";
import type { MarkdownCopyFallback } from "../types";
import { omitRecordKey } from "../lib/setUtils";

interface UseRoomMessageSettersOptions {
  selectedRoomId: string;
  selectedTeamId: string;
  setHostMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setChatMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setMarkdownCopyFallbacksByRoom: Dispatch<SetStateAction<Record<string, MarkdownCopyFallback | null>>>;
  setSecretWarningsVisibleByRoom: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setTeamHistoryMessagesByTeam: Dispatch<SetStateAction<Record<string, string | null>>>;
  setSettingsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
}

export function useRoomMessageSetters({
  selectedRoomId,
  selectedTeamId,
  setHostMessagesByRoom,
  setChatMessagesByRoom,
  setMarkdownCopyFallbacksByRoom,
  setSecretWarningsVisibleByRoom,
  setHistoryMessagesByRoom,
  setTeamHistoryMessagesByTeam,
  setSettingsMessagesByRoom
}: UseRoomMessageSettersOptions) {
  function setHostMessageForRoom(roomId: string, message: string | null) {
    setHostMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedHostMessage(message: string | null) {
    setHostMessageForRoom(selectedRoomId, message);
  }

  function setChatMessageForRoom(roomId: string, message: string | null) {
    setChatMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedChatMessage(message: string | null) {
    setChatMessageForRoom(selectedRoomId, message);
  }

  function setMarkdownCopyFallbackForRoom(roomId: string, fallback: MarkdownCopyFallback | null) {
    setMarkdownCopyFallbacksByRoom((current) => fallback ? { ...current, [roomId]: fallback } : omitRecordKey(current, roomId));
  }

  function setSecretWarningVisibleForRoom(roomId: string, visible: boolean) {
    setSecretWarningsVisibleByRoom((current) => visible ? { ...current, [roomId]: true } : omitRecordKey(current, roomId));
  }

  function setHistoryMessageForRoom(roomId: string, message: string | null) {
    setHistoryMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedHistoryMessage(message: string | null) {
    setHistoryMessageForRoom(selectedRoomId, message);
  }

  function setTeamHistoryMessageForTeam(teamId: string, message: string | null) {
    const key = teamId || "__no-team";
    setTeamHistoryMessagesByTeam((current) => message ? { ...current, [key]: message } : omitRecordKey(current, key));
  }

  function setSelectedTeamHistoryMessage(message: string | null) {
    setTeamHistoryMessageForTeam(selectedTeamId || "__no-team", message);
  }

  function setSettingsMessageForRoom(roomId: string, message: string | null) {
    setSettingsMessagesByRoom((current) => message ? { ...current, [roomId]: message } : omitRecordKey(current, roomId));
  }

  function setSelectedSettingsMessage(message: string | null) {
    setSettingsMessageForRoom(selectedRoomId, message);
  }

  return {
    setHostMessageForRoom,
    setSelectedHostMessage,
    setChatMessageForRoom,
    setSelectedChatMessage,
    setMarkdownCopyFallbackForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage,
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage,
    setSettingsMessageForRoom,
    setSelectedSettingsMessage
  };
}
