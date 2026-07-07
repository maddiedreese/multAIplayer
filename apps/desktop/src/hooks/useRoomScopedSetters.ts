import type { MutableRefObject } from "react";
import { useRoomCodexApprovalSetters } from "./useRoomCodexApprovalSetters";
import { useRoomEventAppenders } from "./useRoomEventAppenders";
import { useRoomFileSetters } from "./useRoomFileSetters";
import { useRoomRequestSetters } from "./useRoomRequestSetters";
import { useRoomTerminalSetters } from "./useRoomTerminalSetters";
import { useAppStore } from "../store/appStore";
import type { RoomRecord } from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

type BusyMap = Record<string, boolean>;

interface RoomBusySettersOptions {
  gitWorkflowBusyRef: MutableRefObject<BusyMap>;
  actionsBusyRef: MutableRefObject<BusyMap>;
  localPreviewBusyRef: MutableRefObject<BusyMap>;
  hostBusyRef: MutableRefObject<BusyMap>;
  settingsBusyRef: MutableRefObject<BusyMap>;
  keyRotationBusyRef: MutableRefObject<BusyMap>;
  fileBusyRef: MutableRefObject<BusyMap>;
  terminalBusyRef: MutableRefObject<BusyMap>;
}

function updateBusyRef(ref: MutableRefObject<BusyMap>, roomId: string, busy: boolean) {
  ref.current = busy ? { ...ref.current, [roomId]: true } : omitRecordKey(ref.current, roomId);
}

export function useRoomScopedSetters({
  selectedRoomId,
  selectedTeamId,
  busy,
  files,
  terminals,
  codexApprovals,
  browser,
  project,
  events,
  requests
}: {
  selectedRoomId: string;
  selectedTeamId: string;
  busy: RoomBusySettersOptions;
  files: Parameters<typeof useRoomFileSetters>[0];
  terminals: Parameters<typeof useRoomTerminalSetters>[0];
  codexApprovals: Parameters<typeof useRoomCodexApprovalSetters>[0];
  browser: {
    defaultBrowserUrl: string;
    defaultBrowserReason: string;
  };
  project: {
    roomsRef: { current: RoomRecord[] };
    defaultCodexModel: string;
    defaultProjectPath: string;
  };
  events: Parameters<typeof useRoomEventAppenders>[0];
  requests: Parameters<typeof useRoomRequestSetters>[0];
}) {
  const setHostMessageForRoom = useAppStore((state) => state.setHostMessageForRoom);
  const setChatMessageForRoom = useAppStore((state) => state.setChatMessageForRoom);
  const setMarkdownCopyFallbackForRoom = useAppStore((state) => state.setMarkdownCopyFallbackForRoom);
  const setSecretWarningVisibleForRoom = useAppStore((state) => state.setSecretWarningVisibleForRoom);
  const setHistoryMessageForRoom = useAppStore((state) => state.setHistoryMessageForRoom);
  const setTeamHistoryMessageForTeam = useAppStore((state) => state.setTeamHistoryMessageForTeam);
  const setSettingsMessageForRoom = useAppStore((state) => state.setSettingsMessageForRoom);
  const setPendingAttachmentsForRoom = useAppStore((state) => state.setPendingAttachmentsForRoom);
  const setDraftForRoom = useAppStore((state) => state.setDraftForRoom);
  const setGitWorkflowMessageForRoom = useAppStore((state) => state.setGitWorkflowMessageForRoom);
  const setGitStatusForRoom = useAppStore((state) => state.setGitStatusForRoom);
  const updateGitWorkflowDraftForRoom = useAppStore((state) => state.updateGitWorkflowDraftForRoom);
  const setBrowserUrlForRoom = useAppStore((state) => state.setBrowserUrlForRoom);
  const setBrowserReasonForRoom = useAppStore((state) => state.setBrowserReasonForRoom);
  const setBrowserMessageForRoom = useAppStore((state) => state.setBrowserMessageForRoom);
  const setInviteLinkForRoom = useAppStore((state) => state.setInviteLinkForRoom);
  const setInviteApprovalGateForRoom = useAppStore((state) => state.setInviteApprovalGateForRoom);
  const setInviteMessageForRoom = useAppStore((state) => state.setInviteMessageForRoom);
  const setCustomCodexModelForRoom = useAppStore((state) => state.setCustomCodexModelForRoom);
  const setProjectPathDraftForRoom = useAppStore((state) => state.setProjectPathDraftForRoom);
  const setGitWorkflowBusyForRoom = useAppStore((state) => state.setGitWorkflowBusyForRoom);
  const setActionsBusyForRoom = useAppStore((state) => state.setActionsBusyForRoom);
  const setLocalPreviewBusyForRoom = useAppStore((state) => state.setLocalPreviewBusyForRoom);
  const setHostBusyForRoom = useAppStore((state) => state.setHostBusyForRoom);
  const setSettingsBusyForRoom = useAppStore((state) => state.setSettingsBusyForRoom);
  const setKeyRotationBusyForRoom = useAppStore((state) => state.setKeyRotationBusyForRoom);
  const setFileBusyForRoom = useAppStore((state) => state.setFileBusyForRoom);
  const setTerminalBusyForRoom = useAppStore((state) => state.setTerminalBusyForRoom);

  const applyBusyForRoom = (
    ref: MutableRefObject<BusyMap>,
    action: (roomId: string, busy: boolean) => void,
    roomId: string,
    isBusy: boolean
  ) => {
    updateBusyRef(ref, roomId, isBusy);
    action(roomId, isBusy);
  };

  return {
    setHostMessageForRoom,
    setSelectedHostMessage: (message: string | null) => setHostMessageForRoom(selectedRoomId, message),
    setChatMessageForRoom,
    setSelectedChatMessage: (message: string | null) => setChatMessageForRoom(selectedRoomId, message),
    setMarkdownCopyFallbackForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage: (message: string | null) => setHistoryMessageForRoom(selectedRoomId, message),
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage: (message: string | null) =>
      setTeamHistoryMessageForTeam(selectedTeamId || "__no-team", message),
    setSettingsMessageForRoom,
    setSelectedSettingsMessage: (message: string | null) => setSettingsMessageForRoom(selectedRoomId, message),
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage: (message: string | null) => setGitWorkflowMessageForRoom(selectedRoomId, message),
    setGitStatusForRoom,
    updateSelectedGitWorkflowDraft: (patch: Parameters<typeof updateGitWorkflowDraftForRoom>[1]) => {
      if (!selectedRoomId) return;
      updateGitWorkflowDraftForRoom(selectedRoomId, patch);
    },
    setBrowserUrlForRoom: (roomId: string, url: string) =>
      setBrowserUrlForRoom(roomId, url, browser.defaultBrowserUrl),
    setBrowserReasonForRoom: (roomId: string, reason: string) =>
      setBrowserReasonForRoom(roomId, reason, browser.defaultBrowserReason),
    setBrowserMessageForRoom,
    setSelectedBrowserMessage: (message: string | null) => setBrowserMessageForRoom(selectedRoomId, message),
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage: (message: string | null) => setInviteMessageForRoom(selectedRoomId, message),
    setCustomCodexModelForRoom: (roomId: string, model: string) => {
      const room = project.roomsRef.current.find((item) => item.id === roomId);
      setCustomCodexModelForRoom(roomId, model, room?.codexModel ?? project.defaultCodexModel);
    },
    setProjectPathDraftForRoom: (roomId: string, projectPath: string) => {
      const room = project.roomsRef.current.find((item) => item.id === roomId);
      setProjectPathDraftForRoom(roomId, projectPath, room?.projectPath ?? project.defaultProjectPath);
    },
    setPendingAttachmentsForRoom,
    setDraftForRoom,
    setGitWorkflowBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.gitWorkflowBusyRef, setGitWorkflowBusyForRoom, roomId, isBusy),
    setActionsBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.actionsBusyRef, setActionsBusyForRoom, roomId, isBusy),
    setLocalPreviewBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.localPreviewBusyRef, setLocalPreviewBusyForRoom, roomId, isBusy),
    setHostBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.hostBusyRef, setHostBusyForRoom, roomId, isBusy),
    setSettingsBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.settingsBusyRef, setSettingsBusyForRoom, roomId, isBusy),
    setKeyRotationBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.keyRotationBusyRef, setKeyRotationBusyForRoom, roomId, isBusy),
    setFileBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.fileBusyRef, setFileBusyForRoom, roomId, isBusy),
    setTerminalBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.terminalBusyRef, setTerminalBusyForRoom, roomId, isBusy),
    ...useRoomFileSetters(files),
    ...useRoomTerminalSetters(terminals),
    ...useRoomCodexApprovalSetters(codexApprovals),
    ...useRoomEventAppenders(events),
    ...useRoomRequestSetters(requests)
  };
}
