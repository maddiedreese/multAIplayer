import type { TeamMemberRecord, TeamRole } from "@multaiplayer/protocol";
import type { RelayStore } from "./state.js";
import { isActiveRoom } from "./relay-domain.js";

export interface RelayAuthz {
  teamIdsForUser(userId: string): Set<string>;
  isTeamMember(teamId: string, userId: string): boolean;
  teamRoleRank(role: TeamRole): number;
  canSetTeamMemberRole(requesterRole: TeamRole | undefined, targetRole: TeamRole, nextRole: TeamRole): boolean;
  canRemoveTeamMember(requesterRole: TeamRole | undefined, targetRole: TeamRole): boolean;
  transferTeamOwnership(members: Map<string, TeamMemberRecord>, nextOwnerUserId: string): Map<string, TeamMemberRecord>;
  canAccessRoom(teamId: string, roomId: string, userId: string): boolean;
}

export function createRelayAuthz(store: RelayStore): RelayAuthz {
  function isTeamMember(teamId: string, userId: string): boolean {
    return store.hasTeamMember(teamId, userId);
  }

  return {
    teamIdsForUser(userId) {
      return store.teamIdsForMember(userId);
    },
    isTeamMember,
    teamRoleRank(role) {
      if (role === "owner") return 0;
      if (role === "admin") return 1;
      return 2;
    },
    canSetTeamMemberRole(requesterRole, targetRole, nextRole) {
      if (targetRole === "owner" || nextRole === "owner") return false;
      if (requesterRole === "owner") return true;
      if (requesterRole !== "admin") return false;
      return targetRole === "member" && nextRole === "member";
    },
    canRemoveTeamMember(requesterRole, targetRole) {
      if (targetRole === "owner") return false;
      if (requesterRole === "owner") return true;
      return requesterRole === "admin" && targetRole === "member";
    },
    transferTeamOwnership(members, nextOwnerUserId) {
      for (const [userId, member] of members.entries()) {
        if (userId === nextOwnerUserId) {
          members.set(userId, { ...member, role: "owner" });
        } else if (member.role === "owner") {
          members.set(userId, { ...member, role: "admin" });
        }
      }
      return members;
    },
    canAccessRoom(teamId, roomId, userId) {
      return isActiveRoom(store, teamId, roomId) && isTeamMember(teamId, userId);
    }
  };
}
