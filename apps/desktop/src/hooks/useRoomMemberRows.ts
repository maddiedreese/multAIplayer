import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { TrustedDeviceKey } from "../lib/identity/deviceTrust";
import type { LocalHostUser } from "../lib/access/roomHost";
import type { RoomPresence } from "../types";
import { buildRoomMemberRows } from "../presentation/roster/rosterDisplayRows";

interface UseRoomMemberRowsOptions {
  presenceByRoom: Record<string, Record<string, RoomPresence>>;
  selectedRoom: ClientRoomRecord | null;
  localUser: LocalHostUser;
  localDeviceId: string;
  localPublicKeyFingerprint?: string;
  trustedDeviceKeys: TrustedDeviceKey[];
}

export function useRoomMemberRows({
  presenceByRoom,
  selectedRoom,
  localUser,
  localDeviceId,
  localPublicKeyFingerprint,
  trustedDeviceKeys
}: UseRoomMemberRowsOptions) {
  if (!selectedRoom) return [];
  return buildRoomMemberRows({
    presence: presenceByRoom[selectedRoom.id] ?? {},
    room: selectedRoom,
    localUser,
    localDeviceId,
    ...(localPublicKeyFingerprint ? { localPublicKeyFingerprint } : {}),
    trustedDeviceKeys
  });
}
