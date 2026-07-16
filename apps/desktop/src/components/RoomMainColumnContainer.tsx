import { ActiveRoomMainColumn, type RoomMainColumnSources } from "./ActiveRoomMainColumn";
import { useAppStore } from "../store/appStore";

export type { RoomMainColumnSources };

export function RoomMainColumnContainer({ sources }: { sources: RoomMainColumnSources }) {
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  if (!selectedRoom) {
    return (
      <main className="room">
        <div className="empty-state">Select or create a room to start collaborating.</div>
      </main>
    );
  }
  return <ActiveRoomMainColumn sources={sources} selectedRoom={selectedRoom} />;
}
