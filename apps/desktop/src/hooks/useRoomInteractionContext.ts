import { createChatActions } from "../lib/chatActions";
import { createRoomVisibilityWarningActions } from "../lib/roomVisibilityWarningActions";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useRoomAccess } from "./useRoomAccess";
import { useRoomInFlightReporters } from "./useRoomInFlightReporters";
import { useRoomMemberRows } from "./useRoomMemberRows";
import { buildRoomNotices } from "../lib/roomNotices";

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
  notices: Parameters<typeof buildRoomNotices>[0];
  visibilityWarning: Parameters<typeof createRoomVisibilityWarningActions>[0];
  access: Parameters<typeof useRoomAccess>[0];
  chat: Omit<Parameters<typeof createChatActions>[0], "isSelectedRoomLocked" | "isSelectedRoomRevoked">;
  githubWorkflow: Parameters<typeof useGitHubWorkflowState>[0];
  memberRows: Parameters<typeof useRoomMemberRows>[0];
}) {
  const reporters = useRoomInFlightReporters(inFlightReporters);
  const roomNotices = buildRoomNotices(notices);
  const visibilityActions = createRoomVisibilityWarningActions(visibilityWarning);
  const accessState = useRoomAccess(access);
  const chatActions = createChatActions({
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
