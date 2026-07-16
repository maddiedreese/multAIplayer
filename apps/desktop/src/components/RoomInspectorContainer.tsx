import { ActiveRoomInspector, type RoomInspectorSources } from "./ActiveRoomInspector";
import { useAppStore } from "../store/appStore";
import type { ClientRoomRecord } from "@multaiplayer/protocol";

export type { RoomInspectorSources };

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
  selectedRoom: ClientRoomRecord;
}) {
  return <ActiveRoomInspector sources={sources} selectedRoom={selectedRoom} />;
}
