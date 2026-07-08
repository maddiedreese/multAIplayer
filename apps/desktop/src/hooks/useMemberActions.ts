import type { Dispatch, SetStateAction } from "react";
import type { TeamMemberRecord, TeamRecord, RoomRecord } from "@multaiplayer/protocol";
import type { SignedInUser } from "../lib/authClient";
import {
  removeTeamMember,
  transferTeamOwnership,
  updateTeamMemberRole
} from "../lib/workspaceClient";
import { buildDeviceFingerprintMarkdown, trustDeviceKey, untrustDeviceKey, type TrustedDeviceKey } from "../lib/deviceTrust";
import { formatTeamMemberName, formatTeamRole } from "../lib/appFormatters";
import { useAppStore } from "../store/appStore";
import type { RoomPresence } from "../types";

interface LocalUser {
  id: string;
  name: string;
}

interface UseMemberActionsOptions {
  selectedTeam: string;
  selectedTeamName: string;
  selectedTeamMembersBusy: boolean;
  selectedRoom: RoomRecord;
  localUser: LocalUser;
  currentUser: SignedInUser | null;
  setDeviceIdentityMessage: (message: string | null) => void;
  setTrustedDeviceKeys: Dispatch<SetStateAction<TrustedDeviceKey[]>>;
  updateTeamRoleForTeam: (teamId: string, role: TeamRecord["role"] | undefined) => void;
  updateTeamMemberCountForTeam: (teamId: string, members: number) => void;
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    setStatus: (message: string | null) => void,
    roomId?: string
  ) => Promise<void>;
}

export function useMemberActions({
  selectedTeam,
  selectedTeamName,
  selectedTeamMembersBusy,
  selectedRoom,
  localUser,
  currentUser,
  setDeviceIdentityMessage,
  setTrustedDeviceKeys,
  updateTeamRoleForTeam,
  updateTeamMemberCountForTeam,
  copyMarkdownWithFallback
}: UseMemberActionsOptions) {
  const setTeamMembersForTeam = useAppStore((state) => state.setTeamMembersForTeam);
  const setTeamMembersMessageForTeam = useAppStore((state) => state.setTeamMembersMessageForTeam);
  const setTeamMembersBusyForTeam = useAppStore((state) => state.setTeamMembersBusyForTeam);

  function trustRoomMemberDevice(member: RoomPresence) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to trust.`);
      return;
    }
    setTrustedDeviceKeys((current) =>
      trustDeviceKey(current, selectedRoom.id, member.deviceId, fingerprint)
    );
    setDeviceIdentityMessage(`Trusted ${member.displayName}'s device identity for ${selectedRoom.name}.`);
  }

  function untrustRoomMemberDevice(member: RoomPresence) {
    setTrustedDeviceKeys((current) => untrustDeviceKey(current, selectedRoom.id, member.deviceId));
    setDeviceIdentityMessage(`Removed local trust for ${member.displayName}'s device identity in ${selectedRoom.name}.`);
  }

  async function copyRoomMemberDeviceFingerprint(member: RoomPresence, trusted: boolean) {
    const fingerprint = member.publicKeyFingerprint;
    if (!fingerprint) {
      setDeviceIdentityMessage(`${member.displayName} has no registered device identity to copy.`);
      return;
    }
    const markdown = buildDeviceFingerprintMarkdown({
      roomName: selectedRoom.name,
      displayName: member.displayName,
      deviceId: member.deviceId,
      fingerprint,
      trusted
    });
    await copyMarkdownWithFallback(
      `${member.displayName} device fingerprint`,
      markdown,
      setDeviceIdentityMessage,
      selectedRoom.id
    );
  }

  async function changeTeamMemberRole(member: TeamMemberRecord, role: "admin" | "member") {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyForTeam(selectedTeam, true);
    setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await updateTeamMemberRole(selectedTeam, member.userId, role);
      setTeamMembersForTeam(selectedTeam, members);
      setTeamMembersMessageForTeam(selectedTeam, `${formatTeamMemberName(member.userId, currentUser)} is now ${formatTeamRole(role)}.`);
    } catch (error) {
      setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  async function transferOwnershipToTeamMember(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyForTeam(selectedTeam, true);
    setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await transferTeamOwnership(selectedTeam, member.userId);
      setTeamMembersForTeam(selectedTeam, members);
      const localMember = members.find((item) => item.userId === localUser.id);
      updateTeamRoleForTeam(selectedTeam, localMember?.role);
      setTeamMembersMessageForTeam(selectedTeam, `${formatTeamMemberName(member.userId, currentUser)} is now the team owner.`);
    } catch (error) {
      setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  async function removeMemberFromTeam(member: TeamMemberRecord) {
    if (!selectedTeam || selectedTeamMembersBusy) return;
    setTeamMembersBusyForTeam(selectedTeam, true);
    setTeamMembersMessageForTeam(selectedTeam, null);
    try {
      const members = await removeTeamMember(selectedTeam, member.userId);
      setTeamMembersForTeam(selectedTeam, members);
      updateTeamMemberCountForTeam(selectedTeam, members.length);
      setTeamMembersMessageForTeam(selectedTeam, `Removed ${formatTeamMemberName(member.userId, currentUser)} from ${selectedTeamName}.`);
    } catch (error) {
      setTeamMembersMessageForTeam(selectedTeam, String(error));
    } finally {
      setTeamMembersBusyForTeam(selectedTeam, false);
    }
  }

  return {
    trustRoomMemberDevice,
    untrustRoomMemberDevice,
    copyRoomMemberDeviceFingerprint,
    changeTeamMemberRole,
    transferOwnershipToTeamMember,
    removeMemberFromTeam
  };
}
