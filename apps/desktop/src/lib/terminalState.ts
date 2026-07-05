export interface RoomTerminalSnapshot {
  id: string;
  roomId: string;
  name: string;
}

export function replaceRoomTerminalSnapshots<T extends RoomTerminalSnapshot>(
  current: T[],
  roomId: string,
  roomSnapshots: T[]
): T[] {
  return [...current.filter((terminal) => terminal.roomId !== roomId), ...roomSnapshots]
    .sort((left, right) => {
      const roomCompare = left.roomId.localeCompare(right.roomId);
      return roomCompare === 0 ? left.name.localeCompare(right.name) : roomCompare;
    });
}
