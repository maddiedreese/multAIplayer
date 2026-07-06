import type { Dispatch, SetStateAction } from "react";
import type {
  BrowserAccessRequest,
  InviteJoinRequest,
  TerminalCommandRequest
} from "../types";

interface UseRoomRequestSettersOptions {
  setInviteRequestsByRoom: Dispatch<SetStateAction<Record<string, InviteJoinRequest[]>>>;
  setTerminalRequestsByRoom: Dispatch<SetStateAction<Record<string, TerminalCommandRequest[]>>>;
  setBrowserRequestsByRoom: Dispatch<SetStateAction<Record<string, BrowserAccessRequest[]>>>;
}

export function useRoomRequestSetters({
  setInviteRequestsByRoom,
  setTerminalRequestsByRoom,
  setBrowserRequestsByRoom
}: UseRoomRequestSettersOptions) {
  function updateInviteRequestStatus(
    roomId: string,
    requestId: string,
    status: InviteJoinRequest["status"]
  ) {
    setInviteRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
  }

  function appendTerminalRequest(roomId: string, request: TerminalCommandRequest) {
    setTerminalRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function updateTerminalRequestStatus(
    roomId: string,
    requestId: string,
    status: TerminalCommandRequest["status"]
  ) {
    setTerminalRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
  }

  function appendBrowserRequest(roomId: string, request: BrowserAccessRequest) {
    setBrowserRequestsByRoom((current) => {
      const roomRequests = current[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return current;
      return {
        ...current,
        [roomId]: [...roomRequests, request]
      };
    });
  }

  function updateBrowserRequestStatus(
    roomId: string,
    requestId: string,
    status: BrowserAccessRequest["status"]
  ) {
    setBrowserRequestsByRoom((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((request) =>
        request.id === requestId ? { ...request, status } : request
      )
    }));
  }

  return {
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  };
}
