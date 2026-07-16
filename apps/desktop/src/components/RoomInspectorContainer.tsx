import { ActiveRoomInspector, type RoomInspectorSources } from "./ActiveRoomInspector";
import { useAppStore } from "../store/appStore";

export type { RoomInspectorSources };

export function RoomInspectorContainer({ sources }: { sources: RoomInspectorSources }) {
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  if (!selectedRoom) return <aside className="inspector" aria-label="Room inspector" />;
  return <ActiveRoomInspector sources={sources} selectedRoom={selectedRoom} />;
}
