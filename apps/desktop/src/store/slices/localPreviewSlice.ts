import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { LocalPreviewDialogState, LocalPreviewRecord } from "../../types";
import type { AppStoreState } from "../appStore";

type LocalPreviewCandidate = LocalPreviewDialogState["candidates"][number];

export interface LocalPreviewRoomState {
  previews?: LocalPreviewRecord[];
  busy?: boolean;
}

export type LocalPreviewByRoom = Record<string, LocalPreviewRoomState>;

function updateLocalPreviewForRoom(
  current: LocalPreviewByRoom,
  roomId: string,
  update: (roomPreview: LocalPreviewRoomState) => LocalPreviewRoomState
): LocalPreviewByRoom {
  const nextRoomPreview = update(current[roomId] ?? {});
  if (Object.keys(nextRoomPreview).length === 0) {
    return roomId in current ? omitRecordKey(current, roomId) : current;
  }
  return { ...current, [roomId]: nextRoomPreview };
}

const emptyLocalPreviewDialog: LocalPreviewDialogState = {
  open: false,
  phase: "select",
  roomId: "",
  candidates: [],
  selectedUrl: "",
  manualUrl: "",
  error: null,
  cloudflaredVersion: null
};

export interface LocalPreviewSlice {
  localPreviewByRoom: LocalPreviewByRoom;
  localPreviewDialog: LocalPreviewDialogState;
  openLocalPreviewDialogForRoom: (roomId: string) => void;
  closeLocalPreviewDialog: () => void;
  setLocalPreviewDialogCandidates: (candidates: LocalPreviewCandidate[], error: string | null) => void;
  setLocalPreviewDialogSelectedUrl: (selectedUrl: string) => void;
  setLocalPreviewDialogManualUrl: (manualUrl: string) => void;
  setLocalPreviewDialogPhase: (phase: LocalPreviewDialogState["phase"], error?: string | null) => void;
  setLocalPreviewDialogConfirmation: (roomId: string, selectedUrl: string, cloudflaredVersion: string | null) => void;
  setLocalPreviewDialogError: (error: string | null) => void;
  setLocalPreviewBusyForRoom: (roomId: string, busy: boolean) => void;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
}

export const emptyLocalPreviewState: Pick<
  LocalPreviewSlice,
  "localPreviewByRoom" | "localPreviewDialog"
> = {
  localPreviewByRoom: {},
  localPreviewDialog: emptyLocalPreviewDialog
};

export const createLocalPreviewSlice: StateCreator<AppStoreState, [], [], LocalPreviewSlice> = (set) => ({
  ...emptyLocalPreviewState,
  openLocalPreviewDialogForRoom: (roomId) => {
    set({
      localPreviewDialog: {
        ...emptyLocalPreviewDialog,
        open: true,
        roomId
      }
    });
  },
  closeLocalPreviewDialog: () => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        open: false
      }
    }));
  },
  setLocalPreviewDialogCandidates: (candidates, error) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        candidates,
        selectedUrl: candidates[0]?.url ?? "",
        error
      }
    }));
  },
  setLocalPreviewDialogSelectedUrl: (selectedUrl) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        selectedUrl
      }
    }));
  },
  setLocalPreviewDialogManualUrl: (manualUrl) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        manualUrl
      }
    }));
  },
  setLocalPreviewDialogPhase: (phase, error = null) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        phase,
        error
      }
    }));
  },
  setLocalPreviewDialogConfirmation: (roomId, selectedUrl, cloudflaredVersion) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        phase: "confirm",
        roomId,
        selectedUrl,
        cloudflaredVersion,
        error: null
      }
    }));
  },
  setLocalPreviewDialogError: (error) => {
    set((state) => ({
      localPreviewDialog: {
        ...state.localPreviewDialog,
        error
      }
    }));
  },
  setLocalPreviewBusyForRoom: (roomId, busy) => {
    set((state) => ({
      localPreviewByRoom: updateLocalPreviewForRoom(state.localPreviewByRoom, roomId, (roomPreview) => {
        const nextRoomPreview = { ...roomPreview };
        if (busy) {
          nextRoomPreview.busy = true;
        } else {
          delete nextRoomPreview.busy;
        }
        return nextRoomPreview;
      })
    }));
  },
  appendLocalPreviewEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.localPreviewByRoom[roomId]?.previews ?? [];
      const nextEvents = roomEvents.some((existing) => existing.id === event.id)
        ? roomEvents.map((existing) => existing.id === event.id ? event : existing)
        : [...roomEvents, event];
      return {
        localPreviewByRoom: updateLocalPreviewForRoom(state.localPreviewByRoom, roomId, (roomPreview) => ({
          ...roomPreview,
          previews: nextEvents.slice(-50)
        }))
      };
    });
  }
});
