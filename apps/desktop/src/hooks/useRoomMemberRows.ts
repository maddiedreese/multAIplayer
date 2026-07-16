import type { ClientRoomRecord } from "@multaiplayer/protocol";
import type { DeviceFingerprintComparisonRecord } from "../lib/identity/deviceFingerprintComparisons";
import type { LocalHostUser } from "../lib/access/roomHost";
import type { RoomPresence } from "../types";
import { buildRoomMemberRows } from "../presentation/roster/rosterDisplayRows";

interface UseRoomMemberRowsOptions {
  presence?: Record<string, RoomPresence> | undefined;
  selectedRoom: ClientRoomRecord | null;
  localUser: LocalHostUser;
  localDeviceId: string;
  localPublicKeyFingerprint?: string;
  deviceFingerprintComparisons: DeviceFingerprintComparisonRecord[];
}

export function useRoomMemberRows({
  presence,
  selectedRoom,
  localUser,
  localDeviceId,
  localPublicKeyFingerprint,
  deviceFingerprintComparisons
}: UseRoomMemberRowsOptions) {
  if (!selectedRoom) return [];
  return buildRoomMemberRows({
    presence: presence ?? {},
    room: selectedRoom,
    localUser,
    localDeviceId,
    ...(localPublicKeyFingerprint ? { localPublicKeyFingerprint } : {}),
    deviceFingerprintComparisons
  });
}
