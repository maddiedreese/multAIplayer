import type { RoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "./authClient";
import type { TrustedDeviceKey } from "./deviceTrust";
import { isDeviceKeyTrusted } from "./deviceTrust";
import {
  formatMemberDeviceLabel,
  formatTeamMemberInitial,
  formatTeamMemberJoinedAt,
  formatTeamMemberName,
  formatTeamRole,
  isRoomHostMember
} from "./appFormatters";
import {
  canDemoteTeamMember,
  canPromoteTeamMember,
  canRemoveTeamMember,
  canTransferTeamOwnership
} from "./teamMemberPermissions";
import type { RoomMemberDisplay, TeamMemberDisplay } from "../components/RosterPanels";
import type { RoomPresence } from "../types";

export function buildTeamMemberRows({
  members,
  team,
  currentUser,
  localUserId
}: {
  members: TeamMemberRecord[];
  team: TeamRecord | null;
  currentUser: SignedInUser | null;
  localUserId: string;
}): TeamMemberDisplay[] {
  return members.map((member) => ({
    member,
    initial: formatTeamMemberInitial(member.userId),
    name: formatTeamMemberName(member.userId, currentUser),
    roleLabel: formatTeamRole(member.role),
    joinedLabel: formatTeamMemberJoinedAt(member.joinedAt),
    canPromote: canPromoteTeamMember(team, member),
    canDemote: canDemoteTeamMember(team, member),
    canTransferOwnership: canTransferTeamOwnership(team, member, localUserId),
    canRemove: canRemoveTeamMember(team, member)
  }));
}

export function buildRoomMemberRows({
  presence,
  room,
  localUser,
  localDeviceId,
  localPublicKeyFingerprint,
  trustedDeviceKeys
}: {
  presence: Record<string, RoomPresence>;
  room: RoomRecord;
  localUser: { id: string; name: string; avatarUrl?: string };
  localDeviceId: string;
  localPublicKeyFingerprint?: string;
  trustedDeviceKeys: TrustedDeviceKey[];
}): RoomMemberDisplay[] {
  const roomMembers = Object.values(presence)
    .filter((member) => member.status === "online")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const visibleRoomMembers: RoomPresence[] = roomMembers.length ? roomMembers : [{
    userId: localUser.id,
    deviceId: localDeviceId,
    displayName: localUser.name,
    avatarUrl: localUser.avatarUrl,
    publicKeyFingerprint: localPublicKeyFingerprint,
    status: "online"
  }];

  return visibleRoomMembers.map((member) => {
    const trusted = isDeviceKeyTrusted(trustedDeviceKeys, room.id, member.deviceId, member.publicKeyFingerprint);
    return {
      ...member,
      trusted,
      isHost: isRoomHostMember(member, room),
      deviceLabel: formatMemberDeviceLabel(member, localDeviceId, trusted)
    };
  });
}
