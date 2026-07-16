import type { MutableRefObject } from "react";
import type { MlsRelayMessage, ClientRoomRecord } from "@multaiplayer/protocol";
import type { AppStoreState } from "../../store/appStore";
import type { ChatMessage } from "../../types";

export type RoutedMlsMessage = MlsRelayMessage & { kind: string };

export interface MlsMessageRouteContext {
  deviceId: string;
  localUser: { id: string; name: string; avatarUrl?: string };
  roomsRef: MutableRefObject<ClientRoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string | null>;
  markIncomingChatUnread: (
    roomId: string,
    selectedRoomId: string | null,
    senderDeviceId: string,
    localDeviceId: string
  ) => void;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: ClientRoomRecord) => boolean;
}

export type MlsMessageStoreActions = Pick<
  AppStoreState,
  | "appendBrowserRequest"
  | "appendCodexEvent"
  | "appendFileSaveRequest"
  | "appendGitWorkflowEvent"
  | "appendHostHandoff"
  | "appendLocalPreviewEvent"
  | "appendRoomMessage"
  | "appendTerminalLinesForRoom"
  | "appendTerminalRequest"
  | "applyAcceptedHostHandoffForRoom"
  | "markHostHandoffRequestedForRoom"
  | "applyGitHubActionsEventForRoom"
  | "applyMessageReaction"
  | "deleteRoomMessage"
  | "editRoomMessage"
  | "enqueueCodexApprovalForRoom"
  | "removeQueuedCodexApprovalForRoom"
  | "replaceRoomRecord"
  | "rememberForgottenRoom"
  | "restoreForgottenRoom"
  | "setApprovalVisibleForRoom"
  | "setChatMessageForRoom"
  | "setGitWorkflowMessageForRoom"
  | "setHostMessageForRoom"
  | "setInviteMessageForRoom"
  | "setPendingCodexApprovalForRoom"
  | "updateBrowserRequestStatus"
  | "updateFileSaveRequestStatus"
  | "updateTerminalRequestStatus"
  | "upsertCodexActivity"
>;
