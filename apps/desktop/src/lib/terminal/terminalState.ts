export interface RoomTerminalSnapshot {
  id: string;
  roomId: string;
  name: string;
}

export interface PersistableTerminalSnapshot extends RoomTerminalSnapshot {
  running: boolean;
  lines: unknown[];
}

export function replaceRoomTerminalSnapshots<T extends RoomTerminalSnapshot>(
  current: T[],
  roomId: string,
  roomSnapshots: T[]
): T[] {
  return [...current.filter((terminal) => terminal.roomId !== roomId), ...roomSnapshots].sort((left, right) => {
    const roomCompare = left.roomId.localeCompare(right.roomId);
    return roomCompare === 0 ? left.name.localeCompare(right.name) : roomCompare;
  });
}

export function upsertTerminal<T extends RoomTerminalSnapshot>(current: T[], snapshot: T): T[] {
  const next = current.some((terminal) => terminal.id === snapshot.id)
    ? current.map((terminal) => (terminal.id === snapshot.id ? snapshot : terminal))
    : [...current, snapshot];
  return next.sort((left, right) => left.name.localeCompare(right.name));
}

export function mergeTerminalSnapshots<T extends PersistableTerminalSnapshot>(remembered: T[], live: T[]): T[] {
  const liveIds = new Set(live.map((terminal) => terminal.id));
  return [...remembered.filter((terminal) => !liveIds.has(terminal.id)).map(terminalForLocalHistory), ...live].sort(
    (left, right) => left.name.localeCompare(right.name)
  );
}

export function terminalsForLocalHistory<T extends PersistableTerminalSnapshot>(terminals: T[]): T[] {
  return terminals.map(terminalForLocalHistory).sort((left, right) => left.name.localeCompare(right.name));
}

function terminalForLocalHistory<T extends PersistableTerminalSnapshot>(terminal: T): T {
  return {
    ...terminal,
    running: false,
    lines: terminal.lines.slice(-1000)
  };
}
