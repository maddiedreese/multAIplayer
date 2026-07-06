import { useState } from "react";
import type { CodexRoomEvent, PendingCodexApproval } from "../types";

export function useCodexRoomState() {
  const [codexEventsByRoom, setCodexEventsByRoom] = useState<Record<string, CodexRoomEvent[]>>({});
  const [approvalVisibleByRoom, setApprovalVisibleByRoom] = useState<Record<string, boolean>>({});
  const [pendingCodexApprovalsByRoom, setPendingCodexApprovalsByRoom] = useState<Record<string, PendingCodexApproval>>({});
  const [codexRunningByRoom, setCodexRunningByRoom] = useState<Record<string, boolean>>({});
  const [secretWarningsVisibleByRoom, setSecretWarningsVisibleByRoom] = useState<Record<string, boolean>>({});
  const [codexThreadIdsByRoom, setCodexThreadIdsByRoom] = useState<Record<string, string>>({});

  return {
    codexEventsByRoom,
    setCodexEventsByRoom,
    approvalVisibleByRoom,
    setApprovalVisibleByRoom,
    pendingCodexApprovalsByRoom,
    setPendingCodexApprovalsByRoom,
    codexRunningByRoom,
    setCodexRunningByRoom,
    secretWarningsVisibleByRoom,
    setSecretWarningsVisibleByRoom,
    codexThreadIdsByRoom,
    setCodexThreadIdsByRoom
  };
}
