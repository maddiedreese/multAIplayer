import type { MutableRefObject } from "react";
import { useAppStore } from "../../store/appStore";
import { omitRecordKey } from "../../lib/core/setUtils";

type BusyMap = Record<string, boolean>;

interface RoomBusyActionsOptions {
  gitWorkflowBusyRef: MutableRefObject<BusyMap>;
  actionsBusyRef: MutableRefObject<BusyMap>;
  localPreviewBusyRef: MutableRefObject<BusyMap>;
  hostBusyRef: MutableRefObject<BusyMap>;
  settingsBusyRef: MutableRefObject<BusyMap>;
  membershipCommitBusyRef: MutableRefObject<BusyMap>;
  fileBusyRef: MutableRefObject<BusyMap>;
  terminalBusyRef: MutableRefObject<BusyMap>;
}

function updateBusyRef(ref: MutableRefObject<BusyMap>, roomId: string, busy: boolean) {
  ref.current = busy ? { ...ref.current, [roomId]: true } : omitRecordKey(ref.current, roomId);
}

export function createRoomActions({
  busy,
  maxTerminalActivityLines,
  browser,
  project
}: {
  busy: RoomBusyActionsOptions;
  maxTerminalActivityLines: number;
  browser: {
    defaultBrowserUrl: string;
    defaultBrowserReason: string;
  };
  project: {
    defaultCodexModel: string;
    defaultProjectPath: string;
  };
}) {
  const withSelectedRoom = (action: (roomId: string) => void) => {
    const roomId = useAppStore.getState().selectedRoomId;
    if (roomId) action(roomId);
  };
  const {
    setHostMessageForRoom,
    setChatMessageForRoom,
    setMarkdownCopyFallbackForRoom,
    setInspectorTabForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setTeamHistoryMessageForTeam,
    setSettingsMessageForRoom,
    setPendingAttachmentsForRoom,
    appendPendingAttachmentForRoom,
    removePendingAttachmentForRoom,
    clearPendingAttachmentsForRoom,
    setDraftForRoom,
    setReplyToMessageForRoom,
    hydrateLocalRoomHistoryForRoom,
    setGitWorkflowMessageForRoom,
    setGitStatusForRoom,
    editGitWorkflowDraftForRoom,
    recordGitHubActionsRefreshForRoom,
    applyGitHubActionsEventForRoom,
    setActionsLastCheckedForRoom,
    setActionsMessageForRoom,
    setBrowserUrlForRoom,
    setBrowserReasonForRoom,
    setBrowserMessageForRoom,
    selectBrowserTabForRoom,
    closeBrowserTabForRoom,
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setCustomCodexModelForRoom,
    setProjectPathDraftForRoom,
    setRoomNotificationsMuted,
    setGitWorkflowBusyForRoom,
    setActionsBusyForRoom,
    setLocalPreviewBusyForRoom,
    setHostBusyForRoom,
    setSettingsBusyForRoom,
    setMembershipCommitBusyForRoom,
    setFileBusyForRoom,
    setTerminalBusyForRoom,
    updateInviteRequestStatus,
    appendTerminalRequest,
    updateTerminalRequestStatus,
    appendBrowserRequest,
    updateBrowserRequestStatus,
    setApprovalVisibleForRoom,
    setPendingCodexApprovalForRoom,
    enqueueCodexApprovalForRoom,
    removeQueuedCodexApprovalForRoom,
    resetCodexApprovalForRoom,
    setCodexRunningForRoom,
    setRoomGoalForRoom,
    setFileQueryForRoom,
    setProjectFilesForRoom,
    setSelectedFileForRoom,
    setSelectedDiffForRoom,
    setFilePreviewTabForRoom,
    setFileMessageForRoom,
    appendFileSaveRequest,
    updateFileSaveRequestStatus,
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom,
    appendTerminalLinesForRoom,
    appendGitWorkflowEvent,
    appendGitHubActionsEvent,
    appendLocalPreviewEvent,
    appendHostHandoff,
    applyAcceptedHostHandoffForRoom,
    appendInviteRequest,
    appendCodexEvent,
    upsertCodexActivity
  } = useAppStore.getState();

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
    setSelectedHostMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setHostMessageForRoom(roomId, message)),
    setChatMessageForRoom,
    setSelectedChatMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setChatMessageForRoom(roomId, message)),
    setMarkdownCopyFallbackForRoom,
    setInspectorTabForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setHistoryMessageForRoom(roomId, message)),
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage: (message: string | null) =>
      setTeamHistoryMessageForTeam(useAppStore.getState().selectedTeam || "__no-team", message),
    setSettingsMessageForRoom,
    setSelectedSettingsMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setSettingsMessageForRoom(roomId, message)),
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setGitWorkflowMessageForRoom(roomId, message)),
    setGitStatusForRoom,
    recordGitHubActionsRefreshForRoom,
    applyGitHubActionsEventForRoom,
    setActionsLastCheckedForRoom,
    setActionsMessageForRoom,
    updateSelectedGitWorkflowDraft: (patch: Parameters<typeof editGitWorkflowDraftForRoom>[1]) => {
      const roomId = useAppStore.getState().selectedRoomId;
      if (!roomId) return;
      editGitWorkflowDraftForRoom(roomId, patch);
    },
    setBrowserUrlForRoom: (roomId: string, url: string) => setBrowserUrlForRoom(roomId, url, browser.defaultBrowserUrl),
    setBrowserReasonForRoom: (roomId: string, reason: string) =>
      setBrowserReasonForRoom(roomId, reason, browser.defaultBrowserReason),
    setBrowserMessageForRoom,
    selectBrowserTabForRoom,
    closeBrowserTabForRoom,
    setSelectedBrowserMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setBrowserMessageForRoom(roomId, message)),
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setInviteMessageForRoom(roomId, message)),
    setCustomCodexModelForRoom: (roomId: string, model: string) => {
      const room = useAppStore.getState().rooms.find((item) => item.id === roomId);
      setCustomCodexModelForRoom(roomId, model, room?.codexModel ?? project.defaultCodexModel);
    },
    setProjectPathDraftForRoom: (roomId: string, projectPath: string) => {
      const room = useAppStore.getState().rooms.find((item) => item.id === roomId);
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
    setMembershipCommitBusyForRoom: (roomId: string, isBusy: boolean) =>
      applyBusyForRoom(busy.membershipCommitBusyRef, setMembershipCommitBusyForRoom, roomId, isBusy),
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
    setSelectedFileMessage: (message: string | null) =>
      withSelectedRoom((roomId) => setFileMessageForRoom(roomId, message)),
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError: (error: string | null) =>
      withSelectedRoom((roomId) => setTerminalErrorForRoom(roomId, error)),
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
