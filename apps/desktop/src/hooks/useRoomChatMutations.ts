import { useAppStore } from "../store/appStore";

export function useRoomChatMutations() {
  const appendRoomMessage = useAppStore((state) => state.appendRoomMessage);
  const applyMessageReaction = useAppStore((state) => state.applyMessageReaction);

  return {
    appendRoomMessage,
    applyMessageReaction
  };
}
