import type { MutableRefObject } from "react";
import {
  BrowserRequestPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  CodexActivityPlaintextPayload,
  CodexApprovalPlaintextPayload,
  CodexEventPlaintextPayload,
  CodexQueuePlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  LocalPreviewPlaintextPayload,
  RequestStatusPlaintextPayload,
  RoomKeyRotationPlaintextPayload,
  RoomSettingsPlaintextPayload,
  TerminalRequestPlaintextPayload,
  TerminalResultPlaintextPayload,
  WorkspaceFileSaveRequestPlaintextPayload,
  type RelayEnvelope,
  type RoomRecord
} from "@multaiplayer/protocol";
import { buildRoomSettingsSystemMessage } from "../../lib/roomSettingsMessages";
import { installRoomSecretEpoch, loadRoomSecret } from "../../lib/localHistory";
import { fingerprintPublicKey, unwrapRoomSecretAuthenticatedFromDevice } from "@multaiplayer/crypto";
import { decryptRoomEnvelope, plaintextUserMatchesEnvelope } from "../../lib/encryptedEnvelope";
import { normalizeChatMessage } from "../../lib/chatSanitizer";
import {
  buildCodexEventLine,
  buildGitHubActionsEventLines,
  buildGitWorkflowEventLines,
  buildTerminalResultLines
} from "../../lib/activityLines";
import { isLegacyDebugChatMessage } from "../../lib/localRoomHistoryPayload";
import { formatMessageTime } from "../../lib/appFormatters";
import { isRoomKeyRotationEnvelopeAuthorized } from "../../lib/roomKeyRotation";
import { findEnvelopeRoom, isEnvelopeFromActiveRoomHost, roomHostEnvelopeRejectionMessage } from "../../lib/roomHost";
import { sendRoomMessageNotification } from "../../lib/roomNotifications";
import {
  approvalDelegationPolicyLabels,
  approvalPolicyLabels,
  maxTerminalActivityLines,
  roomModeLabels
} from "../../seedData";
import { useAppStore, type AppStoreState } from "../../store/appStore";
import type { ChatMessage, QueuedCodexTurn } from "../../types";
import { loadTeamDevices } from "../../lib/workspaceClient";
import { isDeviceKeyTrusted } from "../../lib/deviceTrust";
import { loadPinnedInviteDeviceKey } from "../../lib/inviteCapabilityStore";

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
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown, envelope: RelayEnvelope) => Promise<void>;
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
    if (plaintext) await context.handleInviteEnvelopePlaintext(envelope.roomId, plaintext, envelope);
    return;
  }
  if (envelope.payload.algorithm !== "AES-GCM-256") return;

  const secret = await loadRoomSecret(envelope.roomId, envelope.keyEpoch);
  if (!secret) {
    getStore().rememberForgottenRoom(envelope.roomId);
    return;
  }

  const store = getStore();
  const roomId = envelope.roomId;
  const roomPayload = envelope.payload;
  const decryptJson = <T>(payload: typeof roomPayload, _secret: typeof secret) =>
    decryptRoomEnvelope<T>({ ...envelope, payload }, secret);

  if (envelope.kind === "chat.message") {
    const parsed = ChatPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (!parsed.success) return;
    if (!parsed.data.authorUserId || !plaintextUserMatchesEnvelope(envelope, parsed.data.authorUserId)) return;
    const chatMessage = normalizeChatMessage(parsed.data) as ChatMessage | null;
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
    const parsed = ChatReactionPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.reactorUserId))
      store.applyMessageReaction(roomId, parsed.data);
    return;
  }
  if (envelope.kind === "chat.edit") {
    const parsed = ChatEditPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.editedByUserId))
      store.editRoomMessage(roomId, parsed.data);
    return;
  }
  if (envelope.kind === "chat.delete") {
    const parsed = ChatDeletePlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.deletedByUserId))
      store.deleteRoomMessage(roomId, parsed.data);
    return;
  }
  if (envelope.kind === "terminal.request") {
    const parsed = TerminalRequestPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId))
      store.appendTerminalRequest(roomId, { ...parsed.data, status: "pending" });
    return;
  }
  if (envelope.kind === "terminal.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    const result = TerminalResultPlaintextPayload.safeParse(plaintext);
    if (result.success && plaintextUserMatchesEnvelope(envelope, result.data.ranByUserId)) {
      store.appendTerminalLinesForRoom(roomId, buildTerminalResultLines(result.data), maxTerminalActivityLines);
      return;
    }
    const status = RequestStatusPlaintextPayload.safeParse(plaintext);
    if (status.success && plaintextUserMatchesEnvelope(envelope, status.data.decidedByUserId)) {
      store.updateTerminalRequestStatus(roomId, status.data.requestId, status.data.status);
    }
    return;
  }
  if (envelope.kind === "git.event") {
    const plaintext = await decryptJson<unknown>(roomPayload, secret);
    const workflow = GitWorkflowEventPlaintextPayload.safeParse(plaintext);
    if (workflow.success && plaintextUserMatchesEnvelope(envelope, workflow.data.runnerUserId)) {
      store.appendGitWorkflowEvent(roomId, workflow.data);
      store.appendTerminalLinesForRoom(roomId, buildGitWorkflowEventLines(workflow.data), maxTerminalActivityLines);
      store.setGitWorkflowMessageForRoom(roomId, workflow.data.message);
    }
    const actions = GitHubActionsEventPlaintextPayload.safeParse(plaintext);
    if (actions.success && plaintextUserMatchesEnvelope(envelope, actions.data.checkedByUserId)) {
      store.applyGitHubActionsEventForRoom(roomId, actions.data);
      store.appendTerminalLinesForRoom(roomId, buildGitHubActionsEventLines(actions.data), maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "codex.event") {
    const parsed = CodexEventPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.hostUserId)) {
      store.appendCodexEvent(roomId, parsed.data);
      store.appendTerminalLinesForRoom(roomId, [buildCodexEventLine(parsed.data)], maxTerminalActivityLines);
    }
    return;
  }
  if (envelope.kind === "codex.activity") {
    const parsed = CodexActivityPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.hostUserId))
      store.upsertCodexActivity(roomId, parsed.data);
    return;
  }
  if (envelope.kind === "codex.approval") {
    const parsed = CodexApprovalPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.approverUserId)) {
      store.setHostMessageForRoom(
        roomId,
        "Ignored delegated Codex approval. Only the active host can authorize Codex turns."
      );
    }
    return;
  }
  if (envelope.kind === "codex.queue") {
    const parsed = CodexQueuePlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requestedByUserId))
      handleCodexQueueEvent(parsed.data, roomId, store);
    return;
  }
  if (envelope.kind === "browser.request") {
    const parsed = BrowserRequestPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId))
      store.appendBrowserRequest(roomId, { ...parsed.data, status: "pending" });
    return;
  }
  if (envelope.kind === "browser.event") {
    const parsed = RequestStatusPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.decidedByUserId))
      store.updateBrowserRequestStatus(roomId, parsed.data.requestId, parsed.data.status);
    return;
  }
  if (envelope.kind === "workspace.request") {
    const parsed = WorkspaceFileSaveRequestPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.requesterUserId)) {
      store.appendFileSaveRequest(roomId, { ...parsed.data, status: "pending" });
      store.setChatMessageForRoom(roomId, `${parsed.data.requester} requested a file save.`);
    }
    return;
  }
  if (envelope.kind === "workspace.event") {
    const parsed = RequestStatusPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.decidedByUserId)) {
      store.updateFileSaveRequestStatus(roomId, parsed.data.requestId, parsed.data.status);
    }
    return;
  }
  if (envelope.kind === "preview.event") {
    const parsed = LocalPreviewPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (parsed.success && plaintextUserMatchesEnvelope(envelope, parsed.data.sharedByUserId)) {
      store.appendLocalPreviewEvent(roomId, parsed.data);
      store.setChatMessageForRoom(
        roomId,
        parsed.data.status === "live"
          ? `${parsed.data.sharedBy} shared a local preview.`
          : parsed.data.status === "stopped"
            ? `${parsed.data.sharedBy} stopped sharing a local preview.`
            : (parsed.data.message ?? "Local preview status changed.")
      );
    }
    return;
  }
  if (envelope.kind === "room.host") {
    const parsed = HostHandoffPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (!parsed.success) return;
    const plaintext = parsed.data;
    if (plaintext.status === "accepted") {
      if (plaintext.acceptedByUserId !== envelope.senderUserId) {
        store.setHostMessageForRoom(
          roomId,
          "Rejected host handoff acceptance because the sender did not match the accepting user."
        );
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
    const parsed = RoomSettingsPlaintextPayload.safeParse(await decryptJson<unknown>(roomPayload, secret));
    if (!parsed.success) return;
    const envelopeRoom = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (
      !isEnvelopeFromActiveRoomHost(envelopeRoom, envelope) ||
      parsed.data.changedByUserId !== envelope.senderUserId
    ) {
      return;
    }
    store.appendRoomMessage(
      roomId,
      buildRoomSettingsSystemMessage(parsed.data, {
        approvalPolicyLabels,
        approvalDelegationPolicyLabels,
        roomModeLabels
      })
    );
    return;
  }
  if (envelope.kind === "room.key") {
    const parsed = RoomKeyRotationPlaintextPayload.safeParse(
      await decryptRoomEnvelope<unknown>({ ...envelope, payload: roomPayload }, secret)
    );
    if (!parsed.success) return;
    const plaintext = parsed.data;
    const envelopeRoom = findEnvelopeRoom(context.roomsRef.current, roomId);
    if (!isRoomKeyRotationEnvelopeAuthorized(envelopeRoom, envelope, plaintext)) {
      store.setInviteMessageForRoom(roomId, roomHostEnvelopeRejectionMessage(envelopeRoom, "room access refresh"));
      return;
    }
    if (plaintext.previousEpoch !== envelope.keyEpoch) return;
    const deviceIdentity = getStore().deviceIdentity;
    if (!deviceIdentity) return;
    const recipient = plaintext.recipients.find(
      (item) =>
        item.userId === context.localUser.id &&
        item.deviceId === context.deviceId &&
        item.publicKeyFingerprint === deviceIdentity.publicKeyFingerprint
    );
    if (!recipient) return;
    const hostDevice = (await loadTeamDevices(envelope.teamId)).find(
      (device) => device.userId === envelope.senderUserId && device.deviceId === envelope.senderDeviceId
    );
    if (!hostDevice) return;
    const capabilityPin = loadPinnedInviteDeviceKey(roomId, envelope.senderUserId, envelope.senderDeviceId);
    const expectedHostKey = capabilityPin?.jwk ?? hostDevice.publicKeyJwk;
    const computedHostFingerprint = await fingerprintPublicKey(expectedHostKey as JsonWebKey);
    const capabilityPinValid = capabilityPin?.fingerprint === computedHostFingerprint;
    const manuallyTrusted =
      computedHostFingerprint === hostDevice.publicKeyFingerprint &&
      isDeviceKeyTrusted(getStore().trustedDeviceKeys, roomId, hostDevice.deviceId, computedHostFingerprint);
    if (!capabilityPinValid && !manuallyTrusted) return;
    const newSecret = await unwrapRoomSecretAuthenticatedFromDevice(
      recipient.wrappedRoomSecret,
      deviceIdentity.privateKeyJwk,
      expectedHostKey as JsonWebKey,
      {
        purpose: "room-key-rotation",
        teamId: envelope.teamId,
        roomId,
        senderUserId: envelope.senderUserId,
        senderDeviceId: envelope.senderDeviceId,
        recipientDeviceId: context.deviceId,
        operationId: plaintext.id,
        keyEpoch: envelope.keyEpoch,
        previousEpoch: plaintext.previousEpoch,
        newEpoch: plaintext.newEpoch
      }
    );
    await installRoomSecretEpoch(roomId, plaintext.newEpoch, newSecret);
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
