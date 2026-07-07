import { useRoomBrowserSetters } from "./useRoomBrowserSetters";
import { useRoomBusySetters } from "./useRoomBusySetters";
import { useRoomCodexApprovalSetters } from "./useRoomCodexApprovalSetters";
import { useRoomEventAppenders } from "./useRoomEventAppenders";
import { useRoomFileSetters } from "./useRoomFileSetters";
import { useRoomGitSetters } from "./useRoomGitSetters";
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
  git,
  events,
  requests
}: {
  selectedRoomId: string;
  selectedTeamId: string;
  busy: Parameters<typeof useRoomBusySetters>[0];
  files: Parameters<typeof useRoomFileSetters>[0];
  terminals: Parameters<typeof useRoomTerminalSetters>[0];
  codexApprovals: Parameters<typeof useRoomCodexApprovalSetters>[0];
  browser: Parameters<typeof useRoomBrowserSetters>[0];
  invites: Parameters<typeof useRoomInviteSetters>[0];
  project: Parameters<typeof useRoomProjectSetters>[0];
  git: Parameters<typeof useRoomGitSetters>[0];
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
    setPendingAttachmentsForRoom,
    setDraftForRoom,
    ...useRoomBusySetters(busy),
    ...useRoomFileSetters(files),
    ...useRoomTerminalSetters(terminals),
    ...useRoomCodexApprovalSetters(codexApprovals),
    ...useRoomBrowserSetters(browser),
    ...useRoomInviteSetters(invites),
    ...useRoomProjectSetters(project),
    ...useRoomGitSetters(git),
    ...useRoomEventAppenders(events),
    ...useRoomRequestSetters(requests)
  };
}
