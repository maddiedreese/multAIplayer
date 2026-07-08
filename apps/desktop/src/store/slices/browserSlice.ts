import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { BrowserAccessRequest, BrowserStatus } from "../../types";
import type { AppStoreState } from "../appStore";

export interface BrowserRoomState {
  requests?: BrowserAccessRequest[];
  url?: string;
  reason?: string;
  message?: string | null;
  status?: BrowserStatus;
  activeUrl?: string | null;
}

export type BrowserByRoom = Record<string, BrowserRoomState>;

function compactBrowserRoomState(roomState: BrowserRoomState): BrowserRoomState {
  const next = { ...roomState };
  if (next.requests?.length === 0) {
    next.requests = [];
  }
  return next;
}

function browserRoomStateIsEmpty(roomState: BrowserRoomState): boolean {
  return Object.keys(roomState).length === 0;
}

function updateBrowserForRoom(
  current: BrowserByRoom,
  roomId: string,
  update: (roomState: BrowserRoomState) => BrowserRoomState
): BrowserByRoom {
  const currentRoom = current[roomId] ?? {};
  const nextRoom = compactBrowserRoomState(update(currentRoom));
  if (browserRoomStateIsEmpty(nextRoom)) {
    return roomId in current ? omitRecordKey(current, roomId) : current;
  }
  return {
    ...current,
    [roomId]: nextRoom
  };
}

export interface BrowserSlice {
  browserByRoom: BrowserByRoom;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  openEmbeddedBrowserForRoom: (roomId: string, url: string) => void;
  resetEmbeddedBrowserForRoom: (roomId: string, profilePath: string | null) => void;
  setBrowserUrlForRoom: (roomId: string, url: string, defaultBrowserUrl: string) => void;
  setBrowserReasonForRoom: (roomId: string, reason: string, defaultBrowserReason: string) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  clearBrowserStatusForRoom: (roomId: string) => void;
}

export const emptyBrowserState: Pick<BrowserSlice, "browserByRoom"> = {
  browserByRoom: {}
};

export const createBrowserSlice: StateCreator<AppStoreState, [], [], BrowserSlice> = (set) => ({
  ...emptyBrowserState,
  appendBrowserRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.browserByRoom[roomId]?.requests ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => ({
          ...roomState,
          requests: [...roomRequests, request]
        }))
      };
    });
  },
  updateBrowserRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => ({
        ...roomState,
        requests: (roomState.requests ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }))
    }));
  },
  openEmbeddedBrowserForRoom: (roomId, url) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => ({
        ...roomState,
        activeUrl: url,
        status: {
          profilePath: "Embedded in this room",
          downloadsBlocked: false,
          clipboardBlocked: false,
          fileUploadsBlocked: false
        }
      }))
    }));
  },
  resetEmbeddedBrowserForRoom: (roomId, profilePath) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const nextRoom = { ...roomState };
        delete nextRoom.activeUrl;
        return {
          ...nextRoom,
          status: {
            profilePath,
            downloadsBlocked: false,
            clipboardBlocked: false,
            fileUploadsBlocked: false
          }
        };
      })
    }));
  },
  setBrowserUrlForRoom: (roomId, url, defaultBrowserUrl) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const nextRoom = { ...roomState };
        if (url === defaultBrowserUrl) {
          delete nextRoom.url;
        } else {
          nextRoom.url = url;
        }
        return nextRoom;
      })
    }));
  },
  setBrowserReasonForRoom: (roomId, reason, defaultBrowserReason) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const nextRoom = { ...roomState };
        if (reason === defaultBrowserReason) {
          delete nextRoom.reason;
        } else {
          nextRoom.reason = reason;
        }
        return nextRoom;
      })
    }));
  },
  setBrowserMessageForRoom: (roomId, message) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const nextRoom = { ...roomState };
        if (message) {
          nextRoom.message = message;
        } else {
          delete nextRoom.message;
        }
        return nextRoom;
      })
    }));
  },
  clearBrowserStatusForRoom: (roomId) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const nextRoom = { ...roomState };
        delete nextRoom.status;
        delete nextRoom.activeUrl;
        return nextRoom;
      })
    }));
  }
});
