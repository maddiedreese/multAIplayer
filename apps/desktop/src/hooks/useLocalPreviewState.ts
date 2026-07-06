import { useState } from "react";
import type { LocalPreviewDialogState, LocalPreviewRecord } from "../types";

export function useLocalPreviewState() {
  const [localPreviewsByRoom, setLocalPreviewsByRoom] = useState<Record<string, LocalPreviewRecord[]>>({});
  const [localPreviewDialog, setLocalPreviewDialog] = useState<LocalPreviewDialogState>({
    open: false,
    phase: "select",
    roomId: "",
    candidates: [],
    selectedUrl: "",
    manualUrl: "",
    error: null,
    cloudflaredVersion: null
  });
  const [localPreviewBusyByRoom, setLocalPreviewBusyByRoom] = useState<Record<string, boolean>>({});

  return {
    localPreviewsByRoom,
    setLocalPreviewsByRoom,
    localPreviewDialog,
    setLocalPreviewDialog,
    localPreviewBusyByRoom,
    setLocalPreviewBusyByRoom
  };
}
