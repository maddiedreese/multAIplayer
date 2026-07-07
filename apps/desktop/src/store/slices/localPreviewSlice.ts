import type { StateCreator } from "zustand";
import { omitRecordKey } from "../../lib/setUtils";
import type { LocalPreviewDialogState, LocalPreviewRecord } from "../../types";
import type { AppStoreState } from "../appStore";

type LocalPreviewsByRoom = Record<string, LocalPreviewRecord[]>;
type LocalPreviewBusyByRoom = Record<string, boolean>;
type LocalPreviewCandidate = LocalPreviewDialogState["candidates"][number];

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
  localPreviewsByRoom: LocalPreviewsByRoom;
  localPreviewDialog: LocalPreviewDialogState;
  localPreviewBusyByRoom: LocalPreviewBusyByRoom;
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
  "localPreviewsByRoom" | "localPreviewDialog" | "localPreviewBusyByRoom"
> = {
  localPreviewsByRoom: {},
  localPreviewDialog: emptyLocalPreviewDialog,
  localPreviewBusyByRoom: {}
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
      localPreviewBusyByRoom: busy
        ? { ...state.localPreviewBusyByRoom, [roomId]: true }
        : omitRecordKey(state.localPreviewBusyByRoom, roomId)
    }));
  },
  appendLocalPreviewEvent: (roomId, event) => {
    set((state) => {
      const roomEvents = state.localPreviewsByRoom[roomId] ?? [];
      const nextEvents = roomEvents.some((existing) => existing.id === event.id)
        ? roomEvents.map((existing) => existing.id === event.id ? event : existing)
        : [...roomEvents, event];
      return {
        localPreviewsByRoom: {
          ...state.localPreviewsByRoom,
          [roomId]: nextEvents.slice(-50)
        }
      };
    });
  }
});
