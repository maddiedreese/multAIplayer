import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useLocalIdentity } from "./useLocalIdentity";
import { useSelectedRoomRuntime } from "./useSelectedRoomRuntime";
import { useAppStore } from "../store/appStore";
import { useShallow } from "zustand/react/shallow";

type LocalIdentity = ReturnType<typeof useLocalIdentity>;
type SelectedRoomContext = ReturnType<typeof useAppSelectedRoomContext>;
type RoomInteraction = ReturnType<typeof useAppRoomInteractionContext>;

export function useAppSelectedRoomRuntime({
  localIdentity,
  selected,
  roomInteraction
}: {
  localIdentity: LocalIdentity;
  selected: SelectedRoomContext;
  roomInteraction: RoomInteraction;
}) {
  const {
    selectedRoom,
    messages,
    replyToMessageId,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId
  } = selected;
  const roomId = selectedRoom.id;
  const { selectedRoomId, roomSettings, codexRuntime, localPreview, terminalRuntime, invite, gitRuntime } = useAppStore(
    useShallow((state) => ({
      selectedRoomId: state.selectedRoomId,
      roomSettings: state.roomSettingsByRoom[roomId],
      codexRuntime: state.codexRuntimeByRoom[roomId],
      localPreview: state.localPreviewByRoom[roomId],
      terminalRuntime: state.terminalRuntimeByRoom[roomId],
      invite: state.inviteByRoom[roomId],
      gitRuntime: state.gitWorkflowRuntimeByRoom[roomId]
    }))
  );

  return useSelectedRoomRuntime({
    selectedRoom,
    selectedRoomId,
    localUser: localIdentity.localUser,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    messages,
    replyToMessageId,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId,
    pendingCodexApprovalsByRoom: activeMap(roomId, codexRuntime?.pendingApproval),
    queuedCodexApprovalsByRoom: activeMap(roomId, codexRuntime?.queuedApprovals),
    approvalVisibleByRoom: activeMap(roomId, codexRuntime?.approvalVisible),
    hostHandoffsByRoom: activeMap(roomId, codexRuntime?.hostHandoffs),
    terminalRequestsByRoom: activeMap(roomId, terminalRuntime?.requests),
    localPreviewsByRoom: activeMap(roomId, localPreview?.previews),
    localPreviewBusyByRoom: activeMap(roomId, localPreview?.busy),
    inviteRequestsByRoom: activeMap(roomId, invite?.requests),
    codexEventsByRoom: activeMap(roomId, codexRuntime?.events),
    codexActivitiesByRoom: activeMap(roomId, codexRuntime?.activities),
    gitWorkflowEventsByRoom: activeMap(roomId, gitRuntime?.workflow?.events),
    githubActionsEventsByRoom: activeMap(roomId, gitRuntime?.actions?.events),
    codexThreadIdsByRoom: activeMap(roomId, codexRuntime?.threadGraph?.activeThreadId),
    codexThreadGraphsByRoom: activeMap(roomId, codexRuntime?.threadGraph),
    codexRunningByRoom: activeMap(roomId, codexRuntime?.running),
    hostBusyByRoom: activeMap(roomId, roomSettings?.hostBusy),
    settingsBusyByRoom: activeMap(roomId, roomSettings?.settingsBusy),
    membershipCommitBusyByRoom: activeMap(roomId, invite?.membershipCommitBusy)
  });
}

function activeMap<T>(roomId: string, value: T | null | undefined): Record<string, T> {
  return value == null ? {} : { [roomId]: value };
}
