import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/core/setUtils";
import type { BrowserAccessRequest } from "../../types";
import type { AppStoreState } from "../appStore";
import { reportExpectedFailure } from "../../lib/core/nonFatalReporting";

export interface BrowserRoomState {
  requests?: BrowserAccessRequest[];
  url?: string;
  reason?: string;
  message?: string | null;
  activeUrl?: string | null;
  tabs?: BrowserTab[];
  activeTabId?: string | null;
}

export type BrowserByRoom = Record<string, BrowserRoomState>;

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  openedAt: string;
}

function compactBrowserRoomState(roomState: BrowserRoomState): BrowserRoomState {
  const next = { ...roomState };
  if (next.requests?.length === 0) {
    next.requests = [];
  }
  if (next.tabs?.length === 0) {
    delete next.tabs;
  }
  if (!next.activeTabId) {
    delete next.activeTabId;
  }
  if (!next.activeUrl) {
    delete next.activeUrl;
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

export function projectBrowserRequestsByRoom(browserByRoom: BrowserByRoom): Record<string, BrowserAccessRequest[]> {
  return Object.fromEntries(
    Object.entries(browserByRoom)
      .filter(([, roomBrowser]) => roomBrowser.requests)
      .map(([roomId, roomBrowser]) => [roomId, roomBrowser.requests ?? []])
  );
}

export interface BrowserSlice {
  browserByRoom: BrowserByRoom;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  openEmbeddedBrowserForRoom: (roomId: string, url: string) => void;
  selectBrowserTabForRoom: (roomId: string, tabId: string) => void;
  closeBrowserTabForRoom: (roomId: string, tabId: string) => void;
  recordBrowserNavigationForRoom: (roomId: string, tabId: string, url: string) => void;
  setBrowserUrlForRoom: (roomId: string, url: string, defaultBrowserUrl: string) => void;
  setBrowserReasonForRoom: (roomId: string, reason: string, defaultBrowserReason: string) => void;
  setBrowserMessageForRoom: (roomId: string, message: string | null) => void;
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
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const tabs = roomState.tabs ?? [];
        const existingTab = tabs.find((tab) => tab.url === url);
        const activeTab = existingTab ?? createBrowserTab(url);
        const nextTabs = existingTab ? tabs : [...tabs, activeTab];
        return {
          ...roomState,
          tabs: nextTabs,
          activeTabId: activeTab.id,
          activeUrl: activeTab.url
        };
      })
    }));
  },
  selectBrowserTabForRoom: (roomId, tabId) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const tab = (roomState.tabs ?? []).find((item) => item.id === tabId);
        if (!tab) return roomState;
        return {
          ...roomState,
          activeTabId: tab.id,
          activeUrl: tab.url
        };
      })
    }));
  },
  closeBrowserTabForRoom: (roomId, tabId) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        const tabs = roomState.tabs ?? [];
        const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
        if (closingIndex < 0) return roomState;
        const nextTabs = tabs.filter((tab) => tab.id !== tabId);
        const currentActiveId = roomState.activeTabId ?? activeBrowserTab(roomState)?.id ?? null;
        const nextActiveTab =
          currentActiveId === tabId
            ? (nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null)
            : (nextTabs.find((tab) => tab.id === currentActiveId) ?? null);
        return {
          ...roomState,
          tabs: nextTabs,
          activeTabId: nextActiveTab?.id ?? null,
          activeUrl: nextActiveTab?.url ?? null
        };
      })
    }));
  },
  recordBrowserNavigationForRoom: (roomId, tabId, url) => {
    set((state) => ({
      browserByRoom: updateBrowserForRoom(state.browserByRoom, roomId, (roomState) => {
        if (roomState.activeTabId !== tabId) return roomState;
        const activeTab = (roomState.tabs ?? []).find((tab) => tab.id === tabId);
        if (!activeTab) return roomState;
        return {
          ...roomState,
          url,
          activeUrl: url,
          tabs: (roomState.tabs ?? []).map((tab) =>
            tab.id === activeTab.id ? { ...tab, url, title: browserTabTitle(url) } : tab
          )
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
  }
});

function createBrowserTab(url: string): BrowserTab {
  return {
    id: crypto.randomUUID(),
    url,
    title: browserTabTitle(url),
    openedAt: new Date().toISOString()
  };
}

function activeBrowserTab(roomState: BrowserRoomState): BrowserTab | null {
  const tabs = roomState.tabs ?? [];
  if (roomState.activeTabId) {
    const tab = tabs.find((item) => item.id === roomState.activeTabId);
    if (tab) return tab;
  }
  if (roomState.activeUrl) {
    return tabs.find((item) => item.url === roomState.activeUrl) ?? null;
  }
  return tabs[0] ?? null;
}

function browserTabTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || parsed.toString();
  } catch {
    reportExpectedFailure("browser tab title parser rejected malformed input");
    return url;
  }
}
