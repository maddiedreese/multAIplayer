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
    ...codexRuntimeMaps(roomId, codexRuntime),
    ...supportingRuntimeMaps(roomId, { terminalRuntime, localPreview, invite, gitRuntime, roomSettings })
  });
}

function codexRuntimeMaps(
  roomId: string,
  runtime: ReturnType<typeof useAppStore.getState>["codexRuntimeByRoom"][string] | undefined
) {
  return {
    pendingCodexApprovalsByRoom: activeMap(roomId, runtime?.pendingApproval),
    queuedCodexApprovalsByRoom: activeMap(roomId, runtime?.queuedApprovals),
    approvalVisibleByRoom: activeMap(roomId, runtime?.approvalVisible),
    hostHandoffsByRoom: activeMap(roomId, runtime?.hostHandoffs),
    codexEventsByRoom: activeMap(roomId, runtime?.events),
    codexActivitiesByRoom: activeMap(roomId, runtime?.activities),
    codexThreadIdsByRoom: activeMap(roomId, runtime?.threadGraph?.activeThreadId),
    codexThreadGraphsByRoom: activeMap(roomId, runtime?.threadGraph),
    codexRunningByRoom: activeMap(roomId, runtime?.running)
  };
}

function supportingRuntimeMaps(
  roomId: string,
  sources: Pick<ReturnType<typeof useAppStore.getState>, never> & {
    terminalRuntime: ReturnType<typeof useAppStore.getState>["terminalRuntimeByRoom"][string] | undefined;
    localPreview: ReturnType<typeof useAppStore.getState>["localPreviewByRoom"][string] | undefined;
    invite: ReturnType<typeof useAppStore.getState>["inviteByRoom"][string] | undefined;
    gitRuntime: ReturnType<typeof useAppStore.getState>["gitWorkflowRuntimeByRoom"][string] | undefined;
    roomSettings: ReturnType<typeof useAppStore.getState>["roomSettingsByRoom"][string] | undefined;
  }
) {
  return {
    terminalRequestsByRoom: activeMap(roomId, sources.terminalRuntime?.requests),
    localPreviewsByRoom: activeMap(roomId, sources.localPreview?.previews),
    localPreviewBusyByRoom: activeMap(roomId, sources.localPreview?.busy),
    inviteRequestsByRoom: activeMap(roomId, sources.invite?.requests),
    gitWorkflowEventsByRoom: activeMap(roomId, sources.gitRuntime?.workflow?.events),
    githubActionsEventsByRoom: activeMap(roomId, sources.gitRuntime?.actions?.events),
    hostBusyByRoom: activeMap(roomId, sources.roomSettings?.hostBusy),
    settingsBusyByRoom: activeMap(roomId, sources.roomSettings?.settingsBusy),
    membershipCommitBusyByRoom: activeMap(roomId, sources.invite?.membershipCommitBusy)
  };
}

function activeMap<T>(roomId: string, value: T | null | undefined): Record<string, T> {
  return value == null ? {} : { [roomId]: value };
}
