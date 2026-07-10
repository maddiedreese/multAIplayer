import type { MutableRefObject } from "react";
import type {
  BrowserRequestPlaintextPayload,
  ChatPlaintextPayload,
  HostHandoffPlaintextPayload,
  RelayEnvelope,
  RequestStatusPlaintextPayload,
  RoomRecord,
  TerminalRequestPlaintextPayload
} from "@multaiplayer/protocol";
import { decryptJson } from "@multaiplayer/crypto";
import { buildRoomSettingsSystemMessage } from "../../lib/roomSettingsMessages";
import { loadRoomSecret, replaceRoomSecret } from "../../lib/localHistory";
import { normalizeChatMessage } from "../../lib/chatSanitizer";
import {
  buildCodexEventLine,
  buildGitHubActionsEventLines,
  buildGitWorkflowEventLines,
  buildTerminalResultLines
} from "../../lib/activityLines";
import {
  isChatReactionPlaintextPayload,
  isChatDeletePlaintextPayload,
  isChatEditPlaintextPayload,
  isCodexApprovalPlaintextPayload,
  isCodexEventPlaintextPayload,
  isCodexActivityPlaintextPayload,
  isCodexQueuePlaintextPayload,
  isGitHubActionsEventPlaintextPayload,
  isGitWorkflowEventPlaintextPayload,
  isLegacyDebugChatMessage,
  isLocalPreviewPlaintextPayload,
  isRequestStatusPlaintextPayload,
  isRoomKeyRotationPlaintextPayload,
  isRoomSettingsPlaintextPayload,
  isTerminalResultPlaintextPayload,
  isWorkspaceFileSaveRequestPlaintextPayload
} from "../../lib/localRoomHistoryPayload";
import { formatMessageTime } from "../../lib/appFormatters";
import { isRoomKeyRotationEnvelopeAuthorized } from "../../lib/roomKeyRotation";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  roomHostEnvelopeRejectionMessage
} from "../../lib/roomHost";
import { sendRoomMessageNotification } from "../../lib/roomNotifications";
import {
  approvalDelegationPolicyLabels,
  approvalPolicyLabels,
  maxTerminalActivityLines,
  roomModeLabels
} from "../../seedData";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { ChatMessage, QueuedCodexTurn } from "../../types";

interface LocalUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface RelayEnvelopeRouteContext {
  deviceId: string;
  localUser: LocalUser;
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
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
}

type StoreActions = Pick<
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

export async function routeRelayEnvelope(
  envelope: RelayEnvelope,
  context: RelayEnvelopeRouteContext,
  getStore: () => AppStoreState = useAppStore.getState
): Promise<void> {
  if (envelope.kind === "room.invite") {
    const plaintext = await context.decryptInviteEnvelope(envelope);
    if (plaintext) await context.handleInviteEnvelopePlaintext(envelope.roomId, plaintext);
    return;
  }
  if (envelope.payload.algorithm !== "AES-GCM-256") return;

  const secret = await loadRoomSecret(envelope.roomId);
  if (!secret) {
    getStore().rememberForgottenRoom(envelope.roomId);
    return;
  }

  const store = getStore();
  const roomId = envelope.roomId;
  const roomPayload = envelope.payload;

  if (envelope.kind === "chat.message") {
    const plaintext = await decryptJson<ChatPlaintextPayload>(roomPayload, secret);
    const chatMessage = normalizeChatMessage(plaintext) as ChatMessage | null;
    if (!chatMessage || isLegacyDebugChatMessage(chatMessage)) return;
    context.markIncomingChatUnread(
      roomId,
      context.selectedRoomIdRef.current,
      envelope.senderDeviceId,
      context.deviceId
    );
    store.appendRoomMessage(roomId, chatMessage);
    const envelopeRoom = context.roomsRef.current.find((room) => room.id === roomId);
    const accessState = getStore();
    void sendRoomMessageNotification({
      relayOpen: true,
      room: envelopeRoom,
      message: chatMessage,
      selectedRoomId: context.selectedRoomIdRef.current,
      localDeviceId: context.deviceId,
      senderDeviceId: envelope.senderDeviceId,
      localUserId: context.localUser.id,
      senderUserId: envelope.senderUserId,
      mutedRoomIds: new Set(
        Object.entries(accessState.roomSettingsByRoom)
          .filter(([, settings]) => settings.notificationsMuted)
          .map(([id]) => id)
      ),
      forgottenRoomIds: accessState.forgottenRoomIds,
      revokedRoomIds: accessState.revokedRoomIds,
      revokedTeamIds: accessState.revokedTeamIds
    }).catch(() => console.warn("Failed to send room notification"));
    if (envelopeRoom) context.handleCodexBrowserOpenCommand(chatMessage, envelopeRoom);
    return;
  }

  if (envelope.kind === "chat.reaction") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isChatReactionPlaintextPayload(plaintext)) store.applyMessageReaction(roomId, plaintext);
    return;
  }
  if (envelope.kind === "chat.edit") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isChatEditPlaintextPayload(plaintext)) store.editRoomMessage(roomId, plaintext);
    return;
  }
  if (envelope.kind === "chat.delete") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isChatDeletePlaintextPayload(plaintext)) store.deleteRoomMessage(roomId, plaintext);
    return;
  }
  if (envelope.kind === "terminal.request") {
    const plaintext = await decryptJson<TerminalRequestPlaintextPayload>(roomPayload, secret);
    store.appendTerminalRequest(roomId, { ...plaintext, status: "pending" });
    return;
  }
  if (envelope.kind === "terminal.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isRequestStatusPlaintextPayload(plaintext)) {
      store.updateTerminalRequestStatus(roomId, plaintext.requestId, plaintext.status);
    }
    if (isTerminalResultPlaintextPayload(plaintext)) {
      store.appendTerminalLinesForRoom(roomId, buildTerminalResultLines(plaintext), maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "git.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isGitWorkflowEventPlaintextPayload(plaintext)) {
      store.appendGitWorkflowEvent(roomId, plaintext);
      store.appendTerminalLinesForRoom(roomId, buildGitWorkflowEventLines(plaintext), maxTerminalActivityLines);
      store.setGitWorkflowMessageForRoom(roomId, plaintext.message);
    }
    if (isGitHubActionsEventPlaintextPayload(plaintext)) {
      store.applyGitHubActionsEventForRoom(roomId, plaintext);
      store.appendTerminalLinesForRoom(roomId, buildGitHubActionsEventLines(plaintext), maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "codex.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isCodexEventPlaintextPayload(plaintext)) {
      store.appendCodexEvent(roomId, plaintext);
      store.appendTerminalLinesForRoom(roomId, [buildCodexEventLine(plaintext)], maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "codex.activity") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isCodexActivityPlaintextPayload(plaintext)) store.upsertCodexActivity(roomId, plaintext);
    return;
  }
  if (envelope.kind === "codex.approval") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isCodexApprovalPlaintextPayload(plaintext)) {
      store.setHostMessageForRoom(roomId, "Ignored delegated Codex approval. Only the active host can authorize Codex turns.");
    }
    return;
  }
  if (envelope.kind === "codex.queue") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isCodexQueuePlaintextPayload(plaintext)) handleCodexQueueEvent(plaintext, roomId, store);
    return;
  }
  if (envelope.kind === "browser.request") {
    const plaintext = await decryptJson<BrowserRequestPlaintextPayload>(roomPayload, secret);
    store.appendBrowserRequest(roomId, { ...plaintext, status: "pending" });
    return;
  }
  if (envelope.kind === "browser.event") {
    const plaintext = await decryptJson<RequestStatusPlaintextPayload>(roomPayload, secret);
    store.updateBrowserRequestStatus(roomId, plaintext.requestId, plaintext.status);
    return;
  }
  if (envelope.kind === "workspace.request") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isWorkspaceFileSaveRequestPlaintextPayload(plaintext)) {
      store.appendFileSaveRequest(roomId, { ...plaintext, status: "pending" });
      store.setChatMessageForRoom(roomId, `${plaintext.requester} requested a file save.`);
    }
    return;
  }
  if (envelope.kind === "workspace.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isRequestStatusPlaintextPayload(plaintext)) {
      store.updateFileSaveRequestStatus(roomId, plaintext.requestId, plaintext.status);
    }
    return;
  }
  if (envelope.kind === "preview.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isLocalPreviewPlaintextPayload(plaintext)) {
      store.appendLocalPreviewEvent(roomId, plaintext);
      store.setChatMessageForRoom(
        roomId,
        plaintext.status === "live"
          ? `${plaintext.sharedBy} shared a local preview.`
          : plaintext.status === "stopped"
            ? `${plaintext.sharedBy} stopped sharing a local preview.`
            : plaintext.message ?? "Local preview status changed."
      );
    }
    return;
  }
  if (envelope.kind === "room.host") {
    const plaintext = await decryptJson<HostHandoffPlaintextPayload>(roomPayload, secret);
    if (plaintext.status === "accepted") {
      if (plaintext.acceptedByUserId !== envelope.senderUserId) {
        store.setHostMessageForRoom(roomId, "Rejected host handoff acceptance because the sender did not match the accepting user.");
        return;
      }
      store.applyAcceptedHostHandoffForRoom(roomId, { ...plaintext, status: "accepted" });
      store.setHostMessageForRoom(
        roomId,
        `${plaintext.acceptedBy ?? "A room member"} accepted host handoff from ${plaintext.fromHost}.`
      );
      return;
    }
    const envelopeRoom = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (!isEnvelopeFromActiveRoomHost(envelopeRoom, envelope) || plaintext.fromUserId !== envelope.senderUserId) {
      store.setHostMessageForRoom(roomId, roomHostEnvelopeRejectionMessage(envelopeRoom, "host handoff"));
      return;
    }
    store.appendHostHandoff(roomId, { ...plaintext, status: "available" });
    return;
  }
  if (envelope.kind === "room.settings") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (isRoomSettingsPlaintextPayload(plaintext)) {
      store.appendRoomMessage(roomId, buildRoomSettingsSystemMessage(plaintext, {
        approvalPolicyLabels,
        approvalDelegationPolicyLabels,
        roomModeLabels
      }));
    }
    return;
  }
  if (envelope.kind === "room.key") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    if (!isRoomKeyRotationPlaintextPayload(plaintext)) return;
    const envelopeRoom = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (!isRoomKeyRotationEnvelopeAuthorized(envelopeRoom, envelope, plaintext)) {
      store.setInviteMessageForRoom(roomId, roomHostEnvelopeRejectionMessage(envelopeRoom, "room access refresh"));
      return;
    }
    await replaceRoomSecret(roomId, plaintext.newSecret);
    context.historyLoadedRoomIds.current.add(roomId);
    store.restoreForgottenRoom(roomId);
    store.appendRoomMessage(roomId, {
      id: plaintext.id,
      author: "multAIplayer",
      role: "system",
      body: `${plaintext.rotatedBy} refreshed room access. Future messages and invites use the updated access state.`,
      time: formatMessageTime(plaintext.rotatedAt),
      createdAt: plaintext.rotatedAt
    });
    store.setInviteMessageForRoom(roomId, `${plaintext.rotatedBy} refreshed room access for future messages.`);
  }
}

export function handleCodexQueueEvent(
  event: import("@multaiplayer/protocol").CodexQueuePlaintextPayload,
  roomId: string,
  store: StoreActions
): void {
  if (event.action === "queued" || event.action === "promoted") {
    const turn: QueuedCodexTurn = {
      roomId,
      turnId: event.turnId,
      requestedBy: event.requestedBy,
      requestedByUserId: event.requestedByUserId,
      queuedAt: event.createdAt,
      ...(event.triggerMessageId ? { triggerMessageId: event.triggerMessageId } : {})
    };
    store.enqueueCodexApprovalForRoom(roomId, turn);
    store.setHostMessageForRoom(roomId, `${event.requestedBy} proposed a Codex turn for host approval.`);
    return;
  }
  store.removeQueuedCodexApprovalForRoom(roomId, event.turnId);
  store.setPendingCodexApprovalForRoom(roomId, null);
  store.setApprovalVisibleForRoom(roomId, false);
  store.setHostMessageForRoom(roomId, event.reason ?? `${event.requestedBy}'s Codex turn was ${event.action}.`);
}
