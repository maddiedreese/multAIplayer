import type { SetStateAction } from "react";
import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { BrowserAccessRequest, BrowserStatus } from "../../types";
import type { AppStoreState } from "../appStore";
import { resolveSetStateAction } from "../storeUtils";

type BrowserRequestsByRoom = Record<string, BrowserAccessRequest[]>;
type BrowserUrlsByRoom = Record<string, string>;
type BrowserReasonsByRoom = Record<string, string>;
type BrowserMessagesByRoom = Record<string, string | null>;
type BrowserStatusByRoom = Record<string, BrowserStatus>;
type ActiveBrowserUrlsByRoom = Record<string, string | null>;

export interface BrowserSlice {
  browserRequestsByRoom: BrowserRequestsByRoom;
  browserUrlsByRoom: BrowserUrlsByRoom;
  browserReasonsByRoom: BrowserReasonsByRoom;
  browserMessagesByRoom: BrowserMessagesByRoom;
  browserStatusByRoom: BrowserStatusByRoom;
  activeBrowserUrlsByRoom: ActiveBrowserUrlsByRoom;
  setBrowserRequestsByRoom: (action: SetStateAction<BrowserRequestsByRoom>) => void;
  setBrowserUrlsByRoom: (action: SetStateAction<BrowserUrlsByRoom>) => void;
  setBrowserReasonsByRoom: (action: SetStateAction<BrowserReasonsByRoom>) => void;
  setBrowserMessagesByRoom: (action: SetStateAction<BrowserMessagesByRoom>) => void;
  setBrowserStatusByRoom: (action: SetStateAction<BrowserStatusByRoom>) => void;
  setActiveBrowserUrlsByRoom: (action: SetStateAction<ActiveBrowserUrlsByRoom>) => void;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  openEmbeddedBrowserForRoom: (roomId: string, url: string) => void;
  resetEmbeddedBrowserForRoom: (roomId: string, profilePath: string | null) => void;
  setBrowserUrlForRoom: (roomId: string, url: string, defaultBrowserUrl: string) => void;
  setBrowserReasonForRoom: (roomId: string, reason: string, defaultBrowserReason: string) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
  clearBrowserStatusForRoom: (roomId: string) => void;
}

export const emptyBrowserState: Pick<
  BrowserSlice,
  | "browserRequestsByRoom"
  | "browserUrlsByRoom"
  | "browserReasonsByRoom"
  | "browserMessagesByRoom"
  | "browserStatusByRoom"
  | "activeBrowserUrlsByRoom"
> = {
  browserRequestsByRoom: {},
  browserUrlsByRoom: {},
  browserReasonsByRoom: {},
  browserMessagesByRoom: {},
  browserStatusByRoom: {},
  activeBrowserUrlsByRoom: {}
};

export const createBrowserSlice: StateCreator<AppStoreState, [], [], BrowserSlice> = (set) => ({
  ...emptyBrowserState,
  setBrowserRequestsByRoom: (action) => {
    set((state) => ({
      browserRequestsByRoom: resolveSetStateAction(state.browserRequestsByRoom, action)
    }));
  },
  setBrowserUrlsByRoom: (action) => {
    set((state) => ({
      browserUrlsByRoom: resolveSetStateAction(state.browserUrlsByRoom, action)
    }));
  },
  setBrowserReasonsByRoom: (action) => {
    set((state) => ({
      browserReasonsByRoom: resolveSetStateAction(state.browserReasonsByRoom, action)
    }));
  },
  setBrowserMessagesByRoom: (action) => {
    set((state) => ({
      browserMessagesByRoom: resolveSetStateAction(state.browserMessagesByRoom, action)
    }));
  },
  setBrowserStatusByRoom: (action) => {
    set((state) => ({
      browserStatusByRoom: resolveSetStateAction(state.browserStatusByRoom, action)
    }));
  },
  setActiveBrowserUrlsByRoom: (action) => {
    set((state) => ({
      activeBrowserUrlsByRoom: resolveSetStateAction(state.activeBrowserUrlsByRoom, action)
    }));
  },
  appendBrowserRequest: (roomId, request) => {
    set((state) => {
      const roomRequests = state.browserRequestsByRoom[roomId] ?? [];
      if (roomRequests.some((existing) => existing.id === request.id)) return state;
      return {
        browserRequestsByRoom: {
          ...state.browserRequestsByRoom,
          [roomId]: [...roomRequests, request]
        }
      };
    });
  },
  updateBrowserRequestStatus: (roomId, requestId, status) => {
    set((state) => ({
      browserRequestsByRoom: {
        ...state.browserRequestsByRoom,
        [roomId]: (state.browserRequestsByRoom[roomId] ?? []).map((request) =>
          request.id === requestId ? { ...request, status } : request
        )
      }
    }));
  },
  openEmbeddedBrowserForRoom: (roomId, url) => {
    set((state) => ({
      activeBrowserUrlsByRoom: {
        ...state.activeBrowserUrlsByRoom,
        [roomId]: url
      },
      browserStatusByRoom: {
        ...state.browserStatusByRoom,
        [roomId]: {
          profilePath: "Embedded in this room",
          downloadsBlocked: false,
          clipboardBlocked: false,
          fileUploadsBlocked: false
        }
      }
    }));
  },
  resetEmbeddedBrowserForRoom: (roomId, profilePath) => {
    set((state) => ({
      activeBrowserUrlsByRoom: omitRecordKey(state.activeBrowserUrlsByRoom, roomId),
      browserStatusByRoom: {
        ...state.browserStatusByRoom,
        [roomId]: {
          profilePath,
          downloadsBlocked: false,
          clipboardBlocked: false,
          fileUploadsBlocked: false
        }
      }
    }));
  },
  setBrowserUrlForRoom: (roomId, url, defaultBrowserUrl) => {
    set((state) => ({
      browserUrlsByRoom: url === defaultBrowserUrl
        ? omitRecordKey(state.browserUrlsByRoom, roomId)
        : { ...state.browserUrlsByRoom, [roomId]: url }
    }));
  },
  setBrowserReasonForRoom: (roomId, reason, defaultBrowserReason) => {
    set((state) => ({
      browserReasonsByRoom: reason === defaultBrowserReason
        ? omitRecordKey(state.browserReasonsByRoom, roomId)
        : { ...state.browserReasonsByRoom, [roomId]: reason }
    }));
  },
  setBrowserMessageForRoom: (roomId, message) => {
    set((state) => ({
      browserMessagesByRoom: message
        ? { ...state.browserMessagesByRoom, [roomId]: message }
        : omitRecordKey(state.browserMessagesByRoom, roomId)
    }));
  },
  clearBrowserStatusForRoom: (roomId) => {
    set((state) => ({
      browserStatusByRoom: omitRecordKey(state.browserStatusByRoom, roomId),
      activeBrowserUrlsByRoom: omitRecordKey(state.activeBrowserUrlsByRoom, roomId)
    }));
  }
});
