import { ActiveRoomMainColumn, type RoomMainColumnSources } from "./ActiveRoomMainColumn";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
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
  return <ActiveRoomMainColumnContainer sources={sources} selectedRoom={selectedRoom} />;
}

function ActiveRoomMainColumnContainer({
  sources,
  selectedRoom
}: {
  sources: RoomMainColumnSources;
  selectedRoom: ClientRoomRecord;
}) {
  return <ActiveRoomMainColumn sources={sources} selectedRoom={selectedRoom} />;
}
