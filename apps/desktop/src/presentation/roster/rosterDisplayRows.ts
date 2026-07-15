import type { ClientRoomRecord, TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "../../lib/identity/authClient";
import type { TrustedDeviceKey } from "../../lib/identity/deviceTrust";
import { isDeviceKeyTrusted } from "../../lib/identity/deviceTrust";
import {
  formatMemberDeviceLabel,
  formatTeamMemberInitial,
  formatTeamMemberJoinedAt,
  formatTeamMemberName,
  formatTeamRole,
  isRoomHostMember
} from "../../lib/formatting/appFormatters";
import {
  canDemoteTeamMember,
  canPromoteTeamMember,
  canRemoveTeamMember,
  canTransferTeamOwnership
} from "../../lib/access/teamMemberPermissions";
import type { RoomMemberDisplay, TeamMemberDisplay } from "../../components/RosterPanels";
import type { RoomPresence } from "../../types";

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
  room: ClientRoomRecord;
  localUser: { id: string; name: string; avatarUrl?: string };
  localDeviceId: string;
  localPublicKeyFingerprint?: string;
  trustedDeviceKeys: TrustedDeviceKey[];
}): RoomMemberDisplay[] {
  const roomMembers = Object.values(presence)
    .filter((member) => member.status === "online")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const visibleRoomMembers: RoomPresence[] = roomMembers.length
    ? roomMembers
    : [
        {
          userId: localUser.id,
          deviceId: localDeviceId,
          displayName: localUser.name,
          ...(localUser.avatarUrl ? { avatarUrl: localUser.avatarUrl } : {}),
          ...(localPublicKeyFingerprint ? { publicKeyFingerprint: localPublicKeyFingerprint } : {}),
          status: "online"
        }
      ];

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
