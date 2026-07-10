import type {
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  RelayEnvelope,
  RoomRecord
} from "@multaiplayer/protocol";
import { encryptJson } from "@multaiplayer/crypto";
import { useAppStore } from "../store/appStore";
import { loadOrCreateRoomSecret } from "./localHistory";
import { canUseRoomChat, roomChatGateMessage } from "./chatPolicy";
import { roomLockMessage } from "./appRuntime";
import { messageIsBeforeCodexWatermark } from "./codexMessageWatermark";
import type { RelayClient } from "./relayClient";
import type { ChatMessage, CodexRoomEvent, RelayStatus } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface MutableRef<T> {
  current: T;
}

interface ChatActionsOptions {
  hasSelectedRoom: boolean;
  selectedRoomId: string;
  selectedRoom: RoomRecord;
  isSelectedRoomLocked: boolean;
  isSelectedRoomRevoked: boolean;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  localUser: LocalUser;
  deviceId: string;
  relayStatus: RelayStatus;
  relayRef: MutableRef<RelayClient | null>;
  seenEnvelopeIds: MutableRef<Set<string>>;
  codexEventsByRoom: Record<string, CodexRoomEvent[]>;
}

export function createChatActions({
  hasSelectedRoom,
  selectedRoomId,
  selectedRoom,
  isSelectedRoomLocked,
  isSelectedRoomRevoked,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  localUser,
  deviceId,
  relayStatus,
  relayRef,
  seenEnvelopeIds,
  codexEventsByRoom
}: ChatActionsOptions) {
  async function publishChatMessage(message: ChatMessage, room: RoomRecord = selectedRoom) {
    const revoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    if (forgottenRoomIds.has(room.id) || revoked) {
      useAppStore.getState().setChatMessageForRoom(room.id, roomLockMessage(room, revoked));
      return;
    }
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore.getState().appendRoomMessage(room.id, message);
      return;
    }

    const secret = await loadOrCreateRoomSecret(room.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: room.teamId,
      roomId: room.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: new Date().toISOString(),
      kind: "chat.message",
      payload: await encryptJson(message satisfies ChatPlaintextPayload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    useAppStore.getState().appendRoomMessage(room.id, message);
  }

  async function toggleMessageReaction(message: ChatMessage, emoji: string) {
    if (!hasSelectedRoom) {
      useAppStore.getState().setChatMessageForRoom(selectedRoomId, "Create or join a room before reacting to messages.");
      return;
    }
    const roomId = selectedRoom.id;
    if (isSelectedRoomLocked) {
      useAppStore.getState().setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      useAppStore.getState().setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      return;
    }
    const hasReacted = message.reactions
      ?.find((reaction) => reaction.emoji === emoji)
      ?.reactors.some((reactor) => reactor.userId === localUser.id) ?? false;
    const payload: ChatReactionPlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      emoji,
      action: hasReacted ? "remove" : "add",
      reactor: localUser.name,
      reactorUserId: localUser.id,
      createdAt: new Date().toISOString()
    };
    useAppStore.getState().applyMessageReaction(roomId, payload);

    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore.getState().setChatMessageForRoom(roomId, "Saved reaction locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(roomId);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: selectedRoom.teamId,
      roomId,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt: payload.createdAt,
      kind: "chat.reaction",
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishChatMessageEdit(message: ChatMessage, body: string) {
    if (!canMutateSelectedMessage(message)) return;
    const payload: ChatEditPlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      body,
      editedBy: localUser.name,
      editedByUserId: localUser.id,
      editedAt: new Date().toISOString()
    };
    useAppStore.getState().editRoomMessage(selectedRoom.id, payload);
    await publishChatMutation("chat.edit", payload, payload.editedAt);
  }

  async function publishChatMessageDelete(message: ChatMessage) {
    if (!canMutateSelectedMessage(message)) return;
    const payload: ChatDeletePlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      deletedBy: localUser.name,
      deletedByUserId: localUser.id,
      deletedAt: new Date().toISOString()
    };
    useAppStore.getState().deleteRoomMessage(selectedRoom.id, payload);
    await publishChatMutation("chat.delete", payload, payload.deletedAt);
  }

  async function publishChatMutation(
    kind: "chat.edit" | "chat.delete",
    payload: ChatEditPlaintextPayload | ChatDeletePlaintextPayload,
    createdAt: string
  ) {
    const client = relayRef.current;
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "Saved message change locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(selectedRoom.id);
    const envelope: RelayEnvelope = {
      id: crypto.randomUUID(),
      teamId: selectedRoom.teamId,
      roomId: selectedRoom.id,
      senderDeviceId: deviceId,
      senderUserId: localUser.id,
      createdAt,
      kind,
      payload: await encryptJson(payload, secret)
    };
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  function canMutateSelectedMessage(message: ChatMessage) {
    if (!hasSelectedRoom) {
      useAppStore.getState().setChatMessageForRoom(selectedRoomId, "Create or join a room before editing messages.");
      return false;
    }
    if (isSelectedRoomLocked) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return false;
    }
    if (!canUseRoomChat(selectedRoom)) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, roomChatGateMessage(selectedRoom));
      return false;
    }
    if (message.authorUserId !== localUser.id || message.deletedAt || message.role === "codex") {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "Only your own messages can be changed before Codex uses them.");
      return false;
    }
    if (!messageIsBeforeCodexWatermark(message, codexEventsByRoom[selectedRoom.id] ?? [])) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, "That message was already sent to Codex. Post a follow-up correction instead.");
      return false;
    }
    return true;
  }

  return {
    publishChatMessage,
    publishChatMessageEdit,
    publishChatMessageDelete,
    toggleMessageReaction
  };
}
