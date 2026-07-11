import type {
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  RelayEnvelope,
  RoomRecord
} from "@multaiplayer/protocol";
import { useAppStore } from "../store/appStore";
import { loadOrCreateRoomSecret } from "./localHistory";
import { canUseRoomChat, roomChatGateMessage } from "./chatPolicy";
import { roomLockMessage } from "./appRuntime";
import { messageIsBeforeCodexWatermark } from "./codexMessageWatermark";
import type { RelayClient } from "./relayClient";
import type { ChatMessage } from "../types";
import { currentLocalIdentity } from "./selectedWorkspace";
import { createEncryptedRoomEnvelope, roomKeyEpoch } from "./encryptedEnvelope";

interface MutableRef<T> {
  current: T;
}

interface ChatActionsOptions {
  relayRef: MutableRef<RelayClient | null>;
  seenEnvelopeIds: MutableRef<Set<string>>;
}

export function createChatActions({ relayRef, seenEnvelopeIds }: ChatActionsOptions) {
  const identity = () => currentLocalIdentity();
  const currentSelectedRoom = () => {
    const state = useAppStore.getState();
    return state.rooms.find((room) => room.id === state.selectedRoomId);
  };

  async function publishChatMessage(message: ChatMessage, roomArg?: RoomRecord) {
    const room = roomArg ?? currentSelectedRoom();
    if (!room) return;
    const { forgottenRoomIds, revokedRoomIds, revokedTeamIds } = useAppStore.getState();
    const revoked = revokedRoomIds.has(room.id) || revokedTeamIds.has(room.teamId);
    if (forgottenRoomIds.has(room.id) || revoked) {
      useAppStore.getState().setChatMessageForRoom(room.id, roomLockMessage(room, revoked));
      return;
    }
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore.getState().appendRoomMessage(room.id, message);
      return;
    }

    const secret = await loadOrCreateRoomSecret(room.id);
    const liveMessage: ChatPlaintextPayload = { ...message, authorUserId: identity().localUser.id };
    const envelope: RelayEnvelope = await createEncryptedRoomEnvelope(
      {
        id: crypto.randomUUID(),
        teamId: room.teamId,
        roomId: room.id,
        senderDeviceId: identity().deviceId,
        senderUserId: identity().localUser.id,
        createdAt: new Date().toISOString(),
        kind: "chat.message",
        keyEpoch: roomKeyEpoch(room)
      },
      liveMessage,
      secret
    );
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
    useAppStore.getState().appendRoomMessage(room.id, message);
  }

  async function toggleMessageReaction(message: ChatMessage, emoji: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) {
      useAppStore
        .getState()
        .setChatMessageForRoom(
          useAppStore.getState().selectedRoomId,
          "Create or join a room before reacting to messages."
        );
      return;
    }
    const roomId = selectedRoom.id;
    const { forgottenRoomIds, revokedRoomIds, revokedTeamIds } = useAppStore.getState();
    const isSelectedRoomRevoked = revokedRoomIds.has(roomId) || revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || forgottenRoomIds.has(roomId) || isSelectedRoomRevoked;
    if (isSelectedRoomLocked) {
      useAppStore.getState().setChatMessageForRoom(roomId, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return;
    }
    if (!canUseRoomChat(selectedRoom)) {
      useAppStore.getState().setChatMessageForRoom(roomId, roomChatGateMessage(selectedRoom));
      return;
    }
    const hasReacted =
      message.reactions
        ?.find((reaction) => reaction.emoji === emoji)
        ?.reactors.some((reactor) => reactor.userId === identity().localUser.id) ?? false;
    const payload: ChatReactionPlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      emoji,
      action: hasReacted ? "remove" : "add",
      reactor: identity().localUser.name,
      reactorUserId: identity().localUser.id,
      createdAt: new Date().toISOString()
    };
    useAppStore.getState().applyMessageReaction(roomId, payload);

    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore
        .getState()
        .setChatMessageForRoom(roomId, "Saved reaction locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(roomId);
    const envelope: RelayEnvelope = await createEncryptedRoomEnvelope(
      {
        id: crypto.randomUUID(),
        teamId: selectedRoom.teamId,
        roomId,
        senderDeviceId: identity().deviceId,
        senderUserId: identity().localUser.id,
        createdAt: payload.createdAt,
        kind: "chat.reaction",
        keyEpoch: roomKeyEpoch(selectedRoom)
      },
      payload,
      secret
    );
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  async function publishChatMessageEdit(message: ChatMessage, body: string) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom || !canMutateSelectedMessage(message, selectedRoom)) return;
    const payload: ChatEditPlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      body,
      editedBy: identity().localUser.name,
      editedByUserId: identity().localUser.id,
      editedAt: new Date().toISOString()
    };
    useAppStore.getState().editRoomMessage(selectedRoom.id, payload);
    await publishChatMutation("chat.edit", payload, payload.editedAt);
  }

  async function publishChatMessageDelete(message: ChatMessage) {
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom || !canMutateSelectedMessage(message, selectedRoom)) return;
    const payload: ChatDeletePlaintextPayload = {
      id: crypto.randomUUID(),
      messageId: message.id,
      deletedBy: identity().localUser.name,
      deletedByUserId: identity().localUser.id,
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
    const selectedRoom = currentSelectedRoom();
    if (!selectedRoom) return;
    const client = relayRef.current;
    const { relayStatus } = useAppStore.getState();
    if (!client || relayStatus === "closed" || relayStatus === "error") {
      useAppStore
        .getState()
        .setChatMessageForRoom(selectedRoom.id, "Saved message change locally because the relay is not connected.");
      return;
    }
    const secret = await loadOrCreateRoomSecret(selectedRoom.id);
    const envelope: RelayEnvelope = await createEncryptedRoomEnvelope(
      {
        id: crypto.randomUUID(),
        teamId: selectedRoom.teamId,
        roomId: selectedRoom.id,
        senderDeviceId: identity().deviceId,
        senderUserId: identity().localUser.id,
        createdAt,
        kind,
        keyEpoch: roomKeyEpoch(selectedRoom)
      },
      payload,
      secret
    );
    seenEnvelopeIds.current.add(envelope.id);
    client.publish({ type: "publish", envelope });
  }

  function canMutateSelectedMessage(message: ChatMessage, selectedRoom: RoomRecord) {
    const { forgottenRoomIds, revokedRoomIds, revokedTeamIds, codexRuntimeByRoom } = useAppStore.getState();
    const isSelectedRoomRevoked = revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId);
    const isSelectedRoomLocked =
      selectedRoom.archivedAt != null || forgottenRoomIds.has(selectedRoom.id) || isSelectedRoomRevoked;
    if (isSelectedRoomLocked) {
      useAppStore
        .getState()
        .setChatMessageForRoom(selectedRoom.id, roomLockMessage(selectedRoom, isSelectedRoomRevoked));
      return false;
    }
    if (!canUseRoomChat(selectedRoom)) {
      useAppStore.getState().setChatMessageForRoom(selectedRoom.id, roomChatGateMessage(selectedRoom));
      return false;
    }
    if (message.authorUserId !== identity().localUser.id || message.deletedAt || message.role === "codex") {
      useAppStore
        .getState()
        .setChatMessageForRoom(selectedRoom.id, "Only your own messages can be changed before Codex uses them.");
      return false;
    }
    if (!messageIsBeforeCodexWatermark(message, codexRuntimeByRoom[selectedRoom.id]?.events ?? [])) {
      useAppStore
        .getState()
        .setChatMessageForRoom(
          selectedRoom.id,
          "That message was already sent to Codex. Post a follow-up correction instead."
        );
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
