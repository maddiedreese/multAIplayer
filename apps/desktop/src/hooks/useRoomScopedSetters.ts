import { useRoomBusySetters } from "./useRoomBusySetters";
import { useRoomCodexApprovalSetters } from "./useRoomCodexApprovalSetters";
import { useRoomEventAppenders } from "./useRoomEventAppenders";
import { useRoomFileSetters } from "./useRoomFileSetters";
import { useRoomRequestSetters } from "./useRoomRequestSetters";
import { useRoomTerminalSetters } from "./useRoomTerminalSetters";
import { useAppStore } from "../store/appStore";
import type { RoomRecord } from "@multaiplayer/protocol";

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
  busy: Parameters<typeof useRoomBusySetters>[0];
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
    ...useRoomBusySetters(busy),
    ...useRoomFileSetters(files),
    ...useRoomTerminalSetters(terminals),
    ...useRoomCodexApprovalSetters(codexApprovals),
    ...useRoomEventAppenders(events),
    ...useRoomRequestSetters(requests)
  };
}
