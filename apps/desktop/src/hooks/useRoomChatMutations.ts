import { useAppStore } from "../store/appStore";

export function useRoomChatMutations() {
  const appendRoomMessage = useAppStore((state) => state.appendRoomMessage);
  const editRoomMessage = useAppStore((state) => state.editRoomMessage);
  const deleteRoomMessage = useAppStore((state) => state.deleteRoomMessage);
  const applyMessageReaction = useAppStore((state) => state.applyMessageReaction);

  return {
    appendRoomMessage,
    editRoomMessage,
    deleteRoomMessage,
    applyMessageReaction
  };
}
