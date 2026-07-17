import type { useAppRoomInteractionContext } from "./useAppRoomInteractionContext";
import type { useAppSelectedRoomContext } from "./useAppSelectedRoomContext";
import type { useLocalIdentity } from "./useLocalIdentity";
import { deriveSelectedRoomRuntime, type SelectedRoomRuntimeValues } from "./useSelectedRoomRuntime";
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
  const roomId = selectedRoom?.id ?? null;
  const { roomSettings, codexRuntime, localPreview, terminalRuntime, invite, gitRuntime } = useAppStore(
    useShallow((state) => ({
      roomSettings: roomId ? state.roomSettingsByRoom[roomId] : undefined,
      codexRuntime: roomId ? state.codexRuntimeByRoom[roomId] : undefined,
      localPreview: roomId ? state.localPreviewByRoom[roomId] : undefined,
      terminalRuntime: roomId ? state.terminalRuntimeByRoom[roomId] : undefined,
      invite: roomId ? state.inviteByRoom[roomId] : undefined,
      gitRuntime: roomId ? state.gitWorkflowRuntimeByRoom[roomId] : undefined
    }))
  );

  return deriveSelectedRoomRuntime({
    selectedRoom,
    localUser: localIdentity.localUser,
    isSelectedRoomLocked: roomInteraction.isSelectedRoomLocked,
    messages,
    replyToMessageId,
    pendingAttachments,
    pendingAttachmentBytes,
    browserRequests,
    roomTerminals,
    selectedTerminalId,
    ...selectedCodexRuntimeValues(codexRuntime),
    ...selectedLocalRuntimeValues({ terminalRuntime, localPreview, invite }),
    ...selectedWorkflowRuntimeValues({ invite, gitRuntime, roomSettings })
  });
}

type AppStoreState = ReturnType<typeof useAppStore.getState>;

function selectedCodexRuntimeValues(
  runtime: AppStoreState["codexRuntimeByRoom"][string] | undefined
): Pick<
  SelectedRoomRuntimeValues,
  | "activeCodexApproval"
  | "queuedCodexApprovals"
  | "approvalVisible"
  | "hostHandoffs"
  | "codexEvents"
  | "codexActivities"
  | "selectedCodexThreadId"
  | "codexThreadGraph"
  | "codexRunning"
> {
  return {
    activeCodexApproval: runtime?.pendingApproval ?? null,
    queuedCodexApprovals: runtime?.queuedApprovals ?? [],
    approvalVisible: runtime?.approvalVisible ?? false,
    hostHandoffs: runtime?.hostHandoffs ?? [],
    codexEvents: runtime?.events ?? [],
    codexActivities: runtime?.activities ?? [],
    selectedCodexThreadId: runtime?.threadGraph?.activeThreadId ?? null,
    codexThreadGraph: runtime?.threadGraph ?? { activeThreadId: null, nodesById: {} },
    codexRunning: runtime?.running ?? false
  };
}

function selectedLocalRuntimeValues({
  terminalRuntime,
  localPreview,
  invite
}: {
  terminalRuntime: AppStoreState["terminalRuntimeByRoom"][string] | undefined;
  localPreview: AppStoreState["localPreviewByRoom"][string] | undefined;
  invite: AppStoreState["inviteByRoom"][string] | undefined;
}): Pick<SelectedRoomRuntimeValues, "terminalRequests" | "localPreviews" | "localPreviewBusy" | "inviteRequests"> {
  return {
    terminalRequests: terminalRuntime?.requests ?? [],
    localPreviews: localPreview?.previews ?? [],
    localPreviewBusy: localPreview?.busy ?? false,
    inviteRequests: invite?.requests ?? []
  };
}

function selectedWorkflowRuntimeValues({
  invite,
  gitRuntime,
  roomSettings
}: {
  invite: AppStoreState["inviteByRoom"][string] | undefined;
  gitRuntime: AppStoreState["gitWorkflowRuntimeByRoom"][string] | undefined;
  roomSettings: AppStoreState["roomSettingsByRoom"][string] | undefined;
}): Pick<
  SelectedRoomRuntimeValues,
  "gitWorkflowEvents" | "githubActionsEvents" | "hostBusy" | "settingsBusy" | "membershipCommitBusy"
> {
  return {
    gitWorkflowEvents: gitRuntime?.workflow?.events ?? [],
    githubActionsEvents: gitRuntime?.actions?.events ?? [],
    hostBusy: roomSettings?.hostBusy ?? false,
    settingsBusy: roomSettings?.settingsBusy ?? false,
    membershipCommitBusy: invite?.membershipCommitBusy ?? false
  };
}
