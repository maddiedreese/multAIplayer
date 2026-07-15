import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { TrustedDeviceKey } from "../lib/deviceTrust";
import type { LocalHostUser } from "../lib/roomHost";
import type { RoomPresence } from "../types";
import { buildRoomMemberRows } from "../lib/rosterDisplayRows";

interface UseRoomMemberRowsOptions {
  presenceByRoom: Record<string, Record<string, RoomPresence>>;
  selectedRoom: ClientRoomRecord;
  selectedRoomId: string;
  localUser: LocalHostUser;
  localDeviceId: string;
  localPublicKeyFingerprint?: string;
  trustedDeviceKeys: TrustedDeviceKey[];
}

export function useRoomMemberRows({
  presenceByRoom,
  selectedRoom,
  selectedRoomId,
  localUser,
  localDeviceId,
  localPublicKeyFingerprint,
  trustedDeviceKeys
}: UseRoomMemberRowsOptions) {
  return buildRoomMemberRows({
    presence: presenceByRoom[selectedRoom.id ?? selectedRoomId] ?? {},
    room: selectedRoom,
    localUser,
    localDeviceId,
    localPublicKeyFingerprint,
    trustedDeviceKeys
  });
}
