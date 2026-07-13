import type { MutableRefObject } from "react";
import { useAppStore, type AppStoreState } from "../store/appStore";
import { omitRecordKey } from "./setUtils";

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

type AppStoreActionName = {
  [Key in keyof AppStoreState]: AppStoreState[Key] extends (...args: never[]) => unknown ? Key : never;
}[keyof AppStoreState];

const storeActionCache = new Map<AppStoreActionName, AppStoreState[AppStoreActionName]>();

function storeAction<Key extends AppStoreActionName>(name: Key): AppStoreState[Key] {
  const cached = storeActionCache.get(name);
  if (cached) return cached as AppStoreState[Key];

  const action = ((...args: unknown[]) => {
    const action = useAppStore.getState()[name] as (...actionArgs: unknown[]) => unknown;
    return action(...args);
  }) as AppStoreState[Key];
  storeActionCache.set(name, action);
  return action;
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
  const setHostMessageForRoom = storeAction("setHostMessageForRoom");
  const setChatMessageForRoom = storeAction("setChatMessageForRoom");
  const setMarkdownCopyFallbackForRoom = storeAction("setMarkdownCopyFallbackForRoom");
  const setInspectorTabForRoom = storeAction("setInspectorTabForRoom");
  const setSecretWarningVisibleForRoom = storeAction("setSecretWarningVisibleForRoom");
  const setHistoryMessageForRoom = storeAction("setHistoryMessageForRoom");
  const setTeamHistoryMessageForTeam = storeAction("setTeamHistoryMessageForTeam");
  const setSettingsMessageForRoom = storeAction("setSettingsMessageForRoom");
  const setPendingAttachmentsForRoom = storeAction("setPendingAttachmentsForRoom");
  const appendPendingAttachmentForRoom = storeAction("appendPendingAttachmentForRoom");
  const removePendingAttachmentForRoom = storeAction("removePendingAttachmentForRoom");
  const clearPendingAttachmentsForRoom = storeAction("clearPendingAttachmentsForRoom");
  const setDraftForRoom = storeAction("setDraftForRoom");
  const setReplyToMessageForRoom = storeAction("setReplyToMessageForRoom");
  const hydrateLocalRoomHistoryForRoom = storeAction("hydrateLocalRoomHistoryForRoom");
  const setGitWorkflowMessageForRoom = storeAction("setGitWorkflowMessageForRoom");
  const setGitStatusForRoom = storeAction("setGitStatusForRoom");
  const editGitWorkflowDraftForRoom = storeAction("editGitWorkflowDraftForRoom");
  const recordGitHubActionsRefreshForRoom = storeAction("recordGitHubActionsRefreshForRoom");
  const applyGitHubActionsEventForRoom = storeAction("applyGitHubActionsEventForRoom");
  const setActionsLastCheckedForRoom = storeAction("setActionsLastCheckedForRoom");
  const setActionsMessageForRoom = storeAction("setActionsMessageForRoom");
  const setBrowserUrlForRoom = storeAction("setBrowserUrlForRoom");
  const setBrowserReasonForRoom = storeAction("setBrowserReasonForRoom");
  const setBrowserMessageForRoom = storeAction("setBrowserMessageForRoom");
  const selectBrowserTabForRoom = storeAction("selectBrowserTabForRoom");
  const closeBrowserTabForRoom = storeAction("closeBrowserTabForRoom");
  const clearBrowserStatusForRoom = storeAction("clearBrowserStatusForRoom");
  const setInviteLinkForRoom = storeAction("setInviteLinkForRoom");
  const setInviteApprovalGateForRoom = storeAction("setInviteApprovalGateForRoom");
  const setInviteMessageForRoom = storeAction("setInviteMessageForRoom");
  const setCustomCodexModelForRoom = storeAction("setCustomCodexModelForRoom");
  const setProjectPathDraftForRoom = storeAction("setProjectPathDraftForRoom");
  const setRoomNotificationsMuted = storeAction("setRoomNotificationsMuted");
  const setGitWorkflowBusyForRoom = storeAction("setGitWorkflowBusyForRoom");
  const setActionsBusyForRoom = storeAction("setActionsBusyForRoom");
  const setLocalPreviewBusyForRoom = storeAction("setLocalPreviewBusyForRoom");
  const setHostBusyForRoom = storeAction("setHostBusyForRoom");
  const setSettingsBusyForRoom = storeAction("setSettingsBusyForRoom");
  const setMembershipCommitBusyForRoom = storeAction("setMembershipCommitBusyForRoom");
  const setFileBusyForRoom = storeAction("setFileBusyForRoom");
  const setTerminalBusyForRoom = storeAction("setTerminalBusyForRoom");
  const updateInviteRequestStatus = storeAction("updateInviteRequestStatus");
  const appendTerminalRequest = storeAction("appendTerminalRequest");
  const updateTerminalRequestStatus = storeAction("updateTerminalRequestStatus");
  const appendBrowserRequest = storeAction("appendBrowserRequest");
  const updateBrowserRequestStatus = storeAction("updateBrowserRequestStatus");
  const setApprovalVisibleForRoom = storeAction("setApprovalVisibleForRoom");
  const setPendingCodexApprovalForRoom = storeAction("setPendingCodexApprovalForRoom");
  const enqueueCodexApprovalForRoom = storeAction("enqueueCodexApprovalForRoom");
  const removeQueuedCodexApprovalForRoom = storeAction("removeQueuedCodexApprovalForRoom");
  const resetCodexApprovalForRoom = storeAction("resetCodexApprovalForRoom");
  const setCodexRunningForRoom = storeAction("setCodexRunningForRoom");
  const setRoomGoalForRoom = storeAction("setRoomGoalForRoom");
  const setFileQueryForRoom = storeAction("setFileQueryForRoom");
  const setProjectFilesForRoom = storeAction("setProjectFilesForRoom");
  const setSelectedFileForRoom = storeAction("setSelectedFileForRoom");
  const setSelectedDiffForRoom = storeAction("setSelectedDiffForRoom");
  const setFilePreviewTabForRoom = storeAction("setFilePreviewTabForRoom");
  const setFileMessageForRoom = storeAction("setFileMessageForRoom");
  const appendFileSaveRequest = storeAction("appendFileSaveRequest");
  const updateFileSaveRequestStatus = storeAction("updateFileSaveRequestStatus");
  const resetFileContextForRoom = storeAction("resetFileContextForRoom");
  const setSelectedTerminalIdForRoom = storeAction("setSelectedTerminalIdForRoom");
  const setTerminalErrorForRoom = storeAction("setTerminalErrorForRoom");
  const appendTerminalLinesForRoom = storeAction("appendTerminalLinesForRoom");
  const appendGitWorkflowEvent = storeAction("appendGitWorkflowEvent");
  const appendGitHubActionsEvent = storeAction("appendGitHubActionsEvent");
  const appendLocalPreviewEvent = storeAction("appendLocalPreviewEvent");
  const appendHostHandoff = storeAction("appendHostHandoff");
  const applyAcceptedHostHandoffForRoom = storeAction("applyAcceptedHostHandoffForRoom");
  const appendInviteRequest = storeAction("appendInviteRequest");
  const appendCodexEvent = storeAction("appendCodexEvent");
  const upsertCodexActivity = storeAction("upsertCodexActivity");

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
      setHostMessageForRoom(useAppStore.getState().selectedRoomId, message),
    setChatMessageForRoom,
    setSelectedChatMessage: (message: string | null) =>
      setChatMessageForRoom(useAppStore.getState().selectedRoomId, message),
    setMarkdownCopyFallbackForRoom,
    setInspectorTabForRoom,
    setSecretWarningVisibleForRoom,
    setHistoryMessageForRoom,
    setSelectedHistoryMessage: (message: string | null) =>
      setHistoryMessageForRoom(useAppStore.getState().selectedRoomId, message),
    setTeamHistoryMessageForTeam,
    setSelectedTeamHistoryMessage: (message: string | null) =>
      setTeamHistoryMessageForTeam(useAppStore.getState().selectedTeam || "__no-team", message),
    setSettingsMessageForRoom,
    setSelectedSettingsMessage: (message: string | null) =>
      setSettingsMessageForRoom(useAppStore.getState().selectedRoomId, message),
    setGitWorkflowMessageForRoom,
    setSelectedGitWorkflowMessage: (message: string | null) =>
      setGitWorkflowMessageForRoom(useAppStore.getState().selectedRoomId, message),
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
    clearBrowserStatusForRoom,
    setSelectedBrowserMessage: (message: string | null) =>
      setBrowserMessageForRoom(useAppStore.getState().selectedRoomId, message),
    setInviteLinkForRoom,
    setInviteApprovalGateForRoom,
    setInviteMessageForRoom,
    setSelectedInviteMessage: (message: string | null) =>
      setInviteMessageForRoom(useAppStore.getState().selectedRoomId, message),
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
      setFileMessageForRoom(useAppStore.getState().selectedRoomId, message),
    resetFileContextForRoom,
    setSelectedTerminalIdForRoom,
    setTerminalErrorForRoom,
    setSelectedTerminalError: (error: string | null) =>
      setTerminalErrorForRoom(useAppStore.getState().selectedRoomId, error),
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
