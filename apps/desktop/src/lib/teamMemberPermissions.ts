import type { TeamMemberRecord, TeamRecord } from "@multaiplayer/protocol";

export function canPromoteTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  return team?.role === "owner" && member.role === "member";
}

export function canDemoteTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  return team?.role === "owner" && member.role === "admin";
}

export function canRemoveTeamMember(team: TeamRecord | null, member: TeamMemberRecord): boolean {
  if (member.role === "owner") return false;
  if (team?.role === "owner") return true;
  return team?.role === "admin" && member.role === "member";
}

export function canTransferTeamOwnership(
  team: TeamRecord | null,
  member: TeamMemberRecord,
  localUserId: string
): boolean {
  return team?.role === "owner" && member.role !== "owner" && member.userId !== localUserId;
}
