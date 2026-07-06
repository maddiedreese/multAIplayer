import type { Dispatch, SetStateAction } from "react";
import type {
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload
} from "@multaiplayer/protocol";
import type {
  CodexRoomEvent,
  HostHandoffRecord,
  InviteJoinRequest,
  LocalPreviewRecord
} from "../types";

interface UseRoomEventAppendersOptions {
  setGitWorkflowEventsByRoom: Dispatch<SetStateAction<Record<string, GitWorkflowEventPlaintextPayload[]>>>;
  setGitHubActionsEventsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionsEventPlaintextPayload[]>>>;
  setLocalPreviewsByRoom: Dispatch<SetStateAction<Record<string, LocalPreviewRecord[]>>>;
  setHostHandoffsByRoom: Dispatch<SetStateAction<Record<string, HostHandoffRecord[]>>>;
  setInviteRequestsByRoom: Dispatch<SetStateAction<Record<string, InviteJoinRequest[]>>>;
  setCodexEventsByRoom: Dispatch<SetStateAction<Record<string, CodexRoomEvent[]>>>;
}

export function useRoomEventAppenders({
  setGitWorkflowEventsByRoom,
  setGitHubActionsEventsByRoom,
  setLocalPreviewsByRoom,
  setHostHandoffsByRoom,
  setInviteRequestsByRoom,
  setCodexEventsByRoom
}: UseRoomEventAppendersOptions) {
  function appendGitWorkflowEvent(roomId: string, event: GitWorkflowEventPlaintextPayload) {
    setGitWorkflowEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) => existing.createdAt === event.createdAt && existing.status === event.status && existing.message === event.message)) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-100)
      };
    });
  }

  function appendGitHubActionsEvent(roomId: string, event: GitHubActionsEventPlaintextPayload) {
    setGitHubActionsEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) => existing.checkedAt === event.checkedAt && existing.owner === event.owner && existing.repo === event.repo && existing.branch === event.branch)) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-50)
      };
    });
  }

  function appendLocalPreviewEvent(roomId: string, event: LocalPreviewRecord) {
    setLocalPreviewsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      const nextEvents = roomEvents.some((existing) => existing.id === event.id)
        ? roomEvents.map((existing) => existing.id === event.id ? event : existing)
        : [...roomEvents, event];
      return {
        ...current,
        [roomId]: nextEvents.slice(-50)
      };
    });
  }

  function appendHostHandoff(roomId: string, handoff: HostHandoffRecord) {
    setHostHandoffsByRoom((current) => {
      const roomHandoffs = current[roomId] ?? [];
      if (roomHandoffs.some((existing) => existing.id === handoff.id)) return current;
      return {
        ...current,
        [roomId]: [...roomHandoffs, handoff]
      };
    });
  }

  function appendInviteRequest(roomId: string, request: InviteJoinRequest) {
    setInviteRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function appendCodexEvent(roomId: string, event: CodexRoomEvent) {
    setCodexEventsByRoom((current) => {
      const roomEvents = current[roomId] ?? [];
      if (roomEvents.some((existing) =>
        existing.turnId === event.turnId &&
        existing.createdAt === event.createdAt &&
        existing.status === event.status &&
        existing.message === event.message
      )) {
        return current;
      }
      return {
        ...current,
        [roomId]: [...roomEvents, event].slice(-80)
      };
    });
  }

  return {
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    appendInviteRequest,
    appendCodexEvent
  };
}
