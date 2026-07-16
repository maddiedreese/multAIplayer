import {
  useRoomInspectorComposition,
  type RoomInspectorCapabilities,
  type RoomInspectorSources
} from "../hooks/useRoomInspectorComposition";
import { useAppStore } from "../store/appStore";

export type { RoomInspectorCapabilities, RoomInspectorSources };

export function RoomInspectorContainer({ sources }: { sources: RoomInspectorSources }) {
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  if (!selectedRoom) return <aside className="inspector" aria-label="Room inspector" />;
  return <ActiveRoomInspectorContainer sources={sources} selectedRoom={selectedRoom} />;
}

function ActiveRoomInspectorContainer({
  sources,
  selectedRoom
}: {
  sources: RoomInspectorSources;
  selectedRoom: NonNullable<ReturnType<typeof useAppStore.getState>["rooms"][number]>;
}) {
  return useRoomInspectorComposition({ sources, selectedRoom });
}
