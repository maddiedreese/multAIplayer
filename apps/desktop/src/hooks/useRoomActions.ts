import type { MutableRefObject } from "react";
import { useAppStore } from "../store/appStore";
import type { RoomRecord } from "@multaiplayer/protocol";
import { omitRecordKey } from "../lib/setUtils";

type BusyMap = Record<string, boolean>;

interface RoomBusyActionsOptions {
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

export function useRoomActions({
  selectedRoomId,
  selectedTeamId,
  busy,
  maxTerminalActivityLines,
  browser,
  project
}: {
  selectedRoomId: string;
  selectedTeamId: string;
  busy: RoomBusyActionsOptions;
  maxTerminalActivityLines: number;
  browser: {
    defaultBrowserUrl: string;
    defaultBrowserReason: string;
  };
  project: {
    roomsRef: { current: RoomRecord[] };
    defaultCodexModel: string;
    defaultProjectPath: string;
  };
}) {
  const setHostMessageForRoom = useAppStore((state) => state.setHostMessageForRoom);
  const setChatMessageForRoom = useAppStore((state) => state.setChatMessageForRoom);
  const setMarkdownCopyFallbackForRoom = useAppStore((state) => state.setMarkdownCopyFallbackForRoom);
  const setInspectorTabForRoom = useAppStore((state) => state.setInspectorTabForRoom);
  const setSecretWarningVisibleForRoom = useAppStore((state) => state.setSecretWarningVisibleForRoom);
  const setHistoryMessageForRoom = useAppStore((state) => state.setHistoryMessageForRoom);
  const setTeamHistoryMessageForTeam = useAppStore((state) => state.setTeamHistoryMessageForTeam);
  const setSettingsMessageForRoom = useAppStore((state) => state.setSettingsMessageForRoom);
  const setPendingAttachmentsForRoom = useAppStore((state) => state.setPendingAttachmentsForRoom);
  const appendPendingAttachmentForRoom = useAppStore((state) => state.appendPendingAttachmentForRoom);
  const removePendingAttachmentForRoom = useAppStore((state) => state.removePendingAttachmentForRoom);
  const clearPendingAttachmentsForRoom = useAppStore((state) => state.clearPendingAttachmentsForRoom);
  const setDraftForRoom = useAppStore((state) => state.setDraftForRoom);
  const setReplyToMessageForRoom = useAppStore((state) => state.setReplyToMessageForRoom);
  const hydrateLocalRoomHistoryForRoom = useAppStore((state) => state.hydrateLocalRoomHistoryForRoom);
  const setGitWorkflowMessageForRoom = useAppStore((state) => state.setGitWorkflowMessageForRoom);
  const setGitStatusForRoom = useAppStore((state) => state.setGitStatusForRoom);
  const editGitWorkflowDraftForRoom = useAppStore((state) => state.editGitWorkflowDraftForRoom);
  const recordGitHubActionsRefreshForRoom = useAppStore((state) => state.recordGitHubActionsRefreshForRoom);
  const applyGitHubActionsEventForRoom = useAppStore((state) => state.applyGitHubActionsEventForRoom);
  const setActionsLastCheckedForRoom = useAppStore((state) => state.setActionsLastCheckedForRoom);
  const setActionsMessageForRoom = useAppStore((state) => state.setActionsMessageForRoom);
  const setBrowserUrlForRoom = useAppStore((state) => state.setBrowserUrlForRoom);
  const setBrowserReasonForRoom = useAppStore((state) => state.setBrowserReasonForRoom);
  const setBrowserMessageForRoom = useAppStore((state) => state.setBrowserMessageForRoom);
  const selectBrowserTabForRoom = useAppStore((state) => state.selectBrowserTabForRoom);
  const closeBrowserTabForRoom = useAppStore((state) => state.closeBrowserTabForRoom);
  const clearBrowserStatusForRoom = useAppStore((state) => state.clearBrowserStatusForRoom);
  const setInviteLinkForRoom = useAppStore((state) => state.setInviteLinkForRoom);
  const setInviteApprovalGateForRoom = useAppStore((state) => state.setInviteApprovalGateForRoom);
  const setInviteMessageForRoom = useAppStore((state) => state.setInviteMessageForRoom);
  const setCustomCodexModelForRoom = useAppStore((state) => state.setCustomCodexModelForRoom);
  const setProjectPathDraftForRoom = useAppStore((state) => state.setProjectPathDraftForRoom);
  const setRoomNotificationsMuted = useAppStore((state) => state.setRoomNotificationsMuted);
  const setGitWorkflowBusyForRoom = useAppStore((state) => state.setGitWorkflowBusyForRoom);
  const setActionsBusyForRoom = useAppStore((state) => state.setActionsBusyForRoom);
  const setLocalPreviewBusyForRoom = useAppStore((state) => state.setLocalPreviewBusyForRoom);
  const setHostBusyForRoom = useAppStore((state) => state.setHostBusyForRoom);
  const setSettingsBusyForRoom = useAppStore((state) => state.setSettingsBusyForRoom);
  const setKeyRotationBusyForRoom = useAppStore((state) => state.setKeyRotationBusyForRoom);
  const setFileBusyForRoom = useAppStore((state) => state.setFileBusyForRoom);
  const setTerminalBusyForRoom = useAppStore((state) => state.setTerminalBusyForRoom);
  const updateInviteRequestStatus = useAppStore((state) => state.updateInviteRequestStatus);
  const appendTerminalRequest = useAppStore((state) => state.appendTerminalRequest);
  const updateTerminalRequestStatus = useAppStore((state) => state.updateTerminalRequestStatus);
  const appendBrowserRequest = useAppStore((state) => state.appendBrowserRequest);
  const updateBrowserRequestStatus = useAppStore((state) => state.updateBrowserRequestStatus);
  const setApprovalVisibleForRoom = useAppStore((state) => state.setApprovalVisibleForRoom);
  const setPendingCodexApprovalForRoom = useAppStore((state) => state.setPendingCodexApprovalForRoom);
  const enqueueCodexApprovalForRoom = useAppStore((state) => state.enqueueCodexApprovalForRoom);
  const removeQueuedCodexApprovalForRoom = useAppStore((state) => state.removeQueuedCodexApprovalForRoom);
  const resetCodexApprovalForRoom = useAppStore((state) => state.resetCodexApprovalForRoom);
  const setCodexRunningForRoom = useAppStore((state) => state.setCodexRunningForRoom);
  const setRoomGoalForRoom = useAppStore((state) => state.setRoomGoalForRoom);
  const setFileQueryForRoom = useAppStore((state) => state.setFileQueryForRoom);
  const setProjectFilesForRoom = useAppStore((state) => state.setProjectFilesForRoom);
  const setSelectedFileForRoom = useAppStore((state) => state.setSelectedFileForRoom);
  const setSelectedDiffForRoom = useAppStore((state) => state.setSelectedDiffForRoom);
  const setFilePreviewTabForRoom = useAppStore((state) => state.setFilePreviewTabForRoom);
  const setFileMessageForRoom = useAppStore((state) => state.setFileMessageForRoom);
  const appendFileSaveRequest = useAppStore((state) => state.appendFileSaveRequest);
  const updateFileSaveRequestStatus = useAppStore((state) => state.updateFileSaveRequestStatus);
  const resetFileContextForRoom = useAppStore((state) => state.resetFileContextForRoom);
  const setSelectedTerminalIdForRoom = useAppStore((state) => state.setSelectedTerminalIdForRoom);
  const setTerminalErrorForRoom = useAppStore((state) => state.setTerminalErrorForRoom);
  const appendTerminalLinesForRoom = useAppStore((state) => state.appendTerminalLinesForRoom);
  const appendGitWorkflowEvent = useAppStore((state) => state.appendGitWorkflowEvent);
  const appendGitHubActionsEvent = useAppStore((state) => state.appendGitHubActionsEvent);
  const appendLocalPreviewEvent = useAppStore((state) => state.appendLocalPreviewEvent);
  const appendHostHandoff = useAppStore((state) => state.appendHostHandoff);
  const applyAcceptedHostHandoffForRoom = useAppStore((state) => state.applyAcceptedHostHandoffForRoom);
  const appendInviteRequest = useAppStore((state) => state.appendInviteRequest);
  const appendCodexEvent = useAppStore((state) => state.appendCodexEvent);
  const upsertCodexActivity = useAppStore((state) => state.upsertCodexActivity);

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
    setInspectorTabForRoom,
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
    recordGitHubActionsRefreshForRoom,
    applyGitHubActionsEventForRoom,
    setActionsLastCheckedForRoom,
    setActionsMessageForRoom,
    updateSelectedGitWorkflowDraft: (patch: Parameters<typeof editGitWorkflowDraftForRoom>[1]) => {
      if (!selectedRoomId) return;
      editGitWorkflowDraftForRoom(selectedRoomId, patch);
    },
    setBrowserUrlForRoom: (roomId: string, url: string) =>
      setBrowserUrlForRoom(roomId, url, browser.defaultBrowserUrl),
    setBrowserReasonForRoom: (roomId: string, reason: string) =>
      setBrowserReasonForRoom(roomId, reason, browser.defaultBrowserReason),
    setBrowserMessageForRoom,
    selectBrowserTabForRoom,
    closeBrowserTabForRoom,
    clearBrowserStatusForRoom,
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
    setRoomNotificationsMuted,
    setPendingAttachmentsForRoom,
    appendPendingAttachmentForRoom,
    removePendingAttachmentForRoom,
    clearPendingAttachmentsForRoom,
    setDraftForRoom,
    setReplyToMessageForRoom,
    hydrateLocalRoomHistoryForRoom,
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
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    appendFileSaveRequest,
    updateFileSaveRequestStatus,
    setSelectedFileMessage: (message: string | null) => setFileMessageForRoom(selectedRoomId, message),
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError: (error: string | null) => setTerminalErrorForRoom(selectedRoomId, error),
    appendTerminalLinesForRoom: (roomId: string, lines: string[]) =>
      appendTerminalLinesForRoom(roomId, lines, maxTerminalActivityLines),
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    enqueueCodexApprovalForRoom,
    removeQueuedCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom,
    setRoomGoalForRoom,
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    applyAcceptedHostHandoffForRoom,
    appendInviteRequest,
    appendCodexEvent,
    upsertCodexActivity,
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus
  };
}
