import type { MutableRefObject } from "react";
import type { RelayEnvelope, RoomRecord } from "@multaiplayer/protocol";
import type { AppStoreState } from "../../store/appStore";
import type { ChatMessage } from "../../types";

export interface RelayEnvelopeRouteContext {
  deviceId: string;
  localUser: { id: string; name: string; avatarUrl?: string };
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  markIncomingChatUnread: (
    roomId: string,
    selectedRoomId: string,
    senderDeviceId: string,
    localDeviceId: string
  ) => void;
  decryptInviteEnvelope: (envelope: RelayEnvelope) => Promise<unknown | null>;
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown, envelope: RelayEnvelope) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
}

export type RelayEnvelopeStoreActions = Pick<
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
  | "applyGitHubActionsEventForRoom"
  | "applyMessageReaction"
  | "deleteRoomMessage"
  | "editRoomMessage"
  | "enqueueCodexApprovalForRoom"
  | "removeQueuedCodexApprovalForRoom"
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
