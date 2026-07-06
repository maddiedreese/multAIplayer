import type { Dispatch, SetStateAction } from "react";
import type { ChatReactionPlaintextPayload } from "@multaiplayer/protocol";
import type { ChatMessage } from "../types";

interface UseRoomChatMutationsOptions {
  setMessagesByRoom: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
}

export function useRoomChatMutations({
  setMessagesByRoom
}: UseRoomChatMutationsOptions) {
  function appendRoomMessage(roomId: string, message: ChatMessage) {
    setMessagesByRoom((current) => {
      const roomMessages = current[roomId] ?? [];
      if (roomMessages.some((existing) => existing.id === message.id)) return current;
      return {
        ...current,
        [roomId]: [...roomMessages, message]
      };
    });
  }

  function applyMessageReaction(roomId: string, reaction: ChatReactionPlaintextPayload) {
    setMessagesByRoom((current) => {
      const roomMessages = current[roomId] ?? [];
      return {
        ...current,
        [roomId]: roomMessages.map((message) => {
          if (message.id !== reaction.messageId) return message;
          const reactions = message.reactions ?? [];
          const existing = reactions.find((item) => item.emoji === reaction.emoji);
          const reactors = existing?.reactors.filter((reactor) => reactor.userId !== reaction.reactorUserId) ?? [];
          const nextReactors = reaction.action === "add"
            ? [...reactors, { userId: reaction.reactorUserId, name: reaction.reactor }]
            : reactors;
          const nextReactions = [
            ...reactions.filter((item) => item.emoji !== reaction.emoji),
            ...(nextReactors.length ? [{ emoji: reaction.emoji, reactors: nextReactors }] : [])
          ];
          return {
            ...message,
            reactions: nextReactions
          };
        })
      };
    });
  }

  return {
    appendRoomMessage,
    applyMessageReaction
  };
}
