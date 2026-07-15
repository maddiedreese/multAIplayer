import { createChatActions } from "../application/chat/chatActions";
import { createRoomVisibilityWarningActions } from "../application/rooms/roomVisibilityWarningActions";
import { useGitHubWorkflowState } from "./useGitHubWorkflowState";
import { useRoomAccess } from "./useRoomAccess";
import { useRoomInFlightReporters } from "./useRoomInFlightReporters";
import { useRoomMemberRows } from "./useRoomMemberRows";
import { buildRoomNotices } from "./roomNotices";

export function useRoomInteractionContext({
  inFlightReporters,
  notices,
  access,
  chat,
  githubWorkflow,
  memberRows
}: {
  inFlightReporters: Parameters<typeof useRoomInFlightReporters>[0];
  notices: Parameters<typeof buildRoomNotices>[0];
  access: Parameters<typeof useRoomAccess>[0];
  chat: Parameters<typeof createChatActions>[0];
  githubWorkflow: Parameters<typeof useGitHubWorkflowState>[0];
  memberRows: Parameters<typeof useRoomMemberRows>[0];
}) {
  const reporters = useRoomInFlightReporters(inFlightReporters);
  const roomNotices = buildRoomNotices(notices);
  const visibilityActions = createRoomVisibilityWarningActions();
  const accessState = useRoomAccess(access);
  const chatActions = createChatActions(chat);
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
