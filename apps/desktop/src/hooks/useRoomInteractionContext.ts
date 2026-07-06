import { useChatActions } from "./useChatActions";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useRoomAccess } from "./useRoomAccess";
import { useRoomInFlightReporters } from "./useRoomInFlightReporters";
import { useRoomMemberRows } from "./useRoomMemberRows";
import { useRoomNotices } from "./useRoomNotices";
import { useRoomVisibilityWarningActions } from "./useRoomVisibilityWarningActions";

export function useRoomInteractionContext({
  inFlightReporters,
  notices,
  visibilityWarning,
  access,
  chat,
  githubWorkflow,
  memberRows
}: {
  inFlightReporters: Parameters<typeof useRoomInFlightReporters>[0];
  notices: Parameters<typeof useRoomNotices>[0];
  visibilityWarning: Parameters<typeof useRoomVisibilityWarningActions>[0];
  access: Parameters<typeof useRoomAccess>[0];
  chat: Omit<Parameters<typeof useChatActions>[0], "isSelectedRoomLocked" | "isSelectedRoomRevoked">;
  githubWorkflow: Parameters<typeof useGitHubWorkflowState>[0];
  memberRows: Parameters<typeof useRoomMemberRows>[0];
}) {
  const reporters = useRoomInFlightReporters(inFlightReporters);
  const roomNotices = useRoomNotices(notices);
  const visibilityActions = useRoomVisibilityWarningActions(visibilityWarning);
  const accessState = useRoomAccess(access);
  const chatActions = useChatActions({
    ...chat,
    isSelectedRoomLocked: accessState.isSelectedRoomLocked,
    isSelectedRoomRevoked: accessState.isSelectedRoomRevoked
  });
  const githubWorkflowState = useGitHubWorkflowState(githubWorkflow);
  const roomMemberRows = useRoomMemberRows(memberRows);

  return {
    ...reporters,
    roomNotices,
    ...visibilityActions,
    ...accessState,
    ...chatActions,
    ...githubWorkflowState,
    roomMemberRows
  };
}
