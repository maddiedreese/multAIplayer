import { useRef } from "react";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { RelayClient } from "../lib/relayClient";
import type { GitWorkflowDraft } from "../lib/gitWorkflowDraft";
import type { BrowserAccessRequest } from "../types";
import { useLatestRef } from "./useLatestRef";

type BusyMap = Record<string, boolean>;

interface UseAppRefsOptions {
  rooms: RoomRecord[];
  selectedRoomId: string;
  gitWorkflowDraftsByRoom: Record<string, Partial<GitWorkflowDraft>>;
  hostBusyByRoom: BusyMap;
  settingsBusyByRoom: BusyMap;
  keyRotationBusyByRoom: BusyMap;
  gitWorkflowBusyByRoom: BusyMap;
  actionsBusyByRoom: BusyMap;
  localPreviewBusyByRoom: BusyMap;
  fileBusyByRoom: BusyMap;
  terminalBusyByRoom: BusyMap;
  browserRequestsByRoom: Record<string, BrowserAccessRequest[]>;
}

export function useAppRefs({
  rooms,
  selectedRoomId,
  gitWorkflowDraftsByRoom,
  hostBusyByRoom,
  settingsBusyByRoom,
  keyRotationBusyByRoom,
  gitWorkflowBusyByRoom,
  actionsBusyByRoom,
  localPreviewBusyByRoom,
  fileBusyByRoom,
  terminalBusyByRoom,
  browserRequestsByRoom
}: UseAppRefsOptions) {
  const relayRef = useRef<RelayClient | null>(null);
  const seenEnvelopeIds = useRef(new Set<string>());
  const historyLoadedRoomIds = useRef(new Set<string>());
  const roomsRef = useLatestRef(rooms);
  const selectedRoomIdRef = useLatestRef(selectedRoomId);
  const gitWorkflowDraftsRef = useLatestRef(gitWorkflowDraftsByRoom);
  const hostBusyRef = useLatestRef(hostBusyByRoom);
  const settingsBusyRef = useLatestRef(settingsBusyByRoom);
  const keyRotationBusyRef = useLatestRef(keyRotationBusyByRoom);
  const gitWorkflowBusyRef = useLatestRef(gitWorkflowBusyByRoom);
  const actionsBusyRef = useLatestRef(actionsBusyByRoom);
  const terminalBusyRef = useLatestRef(terminalBusyByRoom);
  const localPreviewBusyRef = useRef(localPreviewBusyByRoom);
  const fileBusyRef = useLatestRef(fileBusyByRoom);
  const browserRequestsRef = useLatestRef(browserRequestsByRoom);

  return {
    relayRef,
    seenEnvelopeIds,
    historyLoadedRoomIds,
    roomsRef,
    selectedRoomIdRef,
    gitWorkflowDraftsRef,
    hostBusyRef,
    settingsBusyRef,
    keyRotationBusyRef,
    gitWorkflowBusyRef,
    actionsBusyRef,
    terminalBusyRef,
    localPreviewBusyRef,
    fileBusyRef,
    browserRequestsRef
  };
}
