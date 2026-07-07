import { useRoomBusySetters } from "./useRoomBusySetters";
import { useRoomCodexApprovalSetters } from "./useRoomCodexApprovalSetters";
import { useRoomEventAppenders } from "./useRoomEventAppenders";
import { useRoomFileSetters } from "./useRoomFileSetters";
import { useRoomInviteSetters } from "./useRoomInviteSetters";
import { useRoomProjectSetters } from "./useRoomProjectSetters";
import { useRoomRequestSetters } from "./useRoomRequestSetters";
import { useRoomTerminalSetters } from "./useRoomTerminalSetters";
import { useAppStore } from "../store/appStore";

export function useRoomScopedSetters({
  selectedRoomId,
  selectedTeamId,
  busy,
  files,
  terminals,
  codexApprovals,
  browser,
  invites,
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
  invites: Parameters<typeof useRoomInviteSetters>[0];
  project: Parameters<typeof useRoomProjectSetters>[0];
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
    setPendingAttachmentsForRoom,
    setDraftForRoom,
    ...useRoomBusySetters(busy),
    ...useRoomFileSetters(files),
    ...useRoomTerminalSetters(terminals),
    ...useRoomCodexApprovalSetters(codexApprovals),
    ...useRoomInviteSetters(invites),
    ...useRoomProjectSetters(project),
    ...useRoomEventAppenders(events),
    ...useRoomRequestSetters(requests)
  };
}
