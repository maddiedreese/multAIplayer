import { useAppStore } from "../store/appStore";

export function useInvitePanelState() {
  const inviteRequestsByRoom = useAppStore((state) => state.inviteRequestsByRoom);
  const setInviteRequestsByRoom = useAppStore((state) => state.setInviteRequestsByRoom);
  const inviteSecretInput = useAppStore((state) => state.inviteSecretInput);
  const setInviteSecretInput = useAppStore((state) => state.setInviteSecretInput);
  const inviteLinksByRoom = useAppStore((state) => state.inviteLinksByRoom);
  const setInviteLinksByRoom = useAppStore((state) => state.setInviteLinksByRoom);
  const inviteApprovalGatesByRoom = useAppStore((state) => state.inviteApprovalGatesByRoom);
  const setInviteApprovalGatesByRoom = useAppStore((state) => state.setInviteApprovalGatesByRoom);
  const inviteMessagesByRoom = useAppStore((state) => state.inviteMessagesByRoom);
  const setInviteMessagesByRoom = useAppStore((state) => state.setInviteMessagesByRoom);
  const keyRotationBusyByRoom = useAppStore((state) => state.keyRotationBusyByRoom);
  const setKeyRotationBusyByRoom = useAppStore((state) => state.setKeyRotationBusyByRoom);
  const inviteAdmissionsByRoom = useAppStore((state) => state.inviteAdmissionsByRoom);
  const setInviteAdmissionsByRoom = useAppStore((state) => state.setInviteAdmissionsByRoom);

  return {
    inviteRequestsByRoom,
    setInviteRequestsByRoom,
    inviteSecretInput,
    setInviteSecretInput,
    inviteLinksByRoom,
    setInviteLinksByRoom,
    inviteApprovalGatesByRoom,
    setInviteApprovalGatesByRoom,
    inviteMessagesByRoom,
    setInviteMessagesByRoom,
    keyRotationBusyByRoom,
    setKeyRotationBusyByRoom,
    inviteAdmissionsByRoom,
    setInviteAdmissionsByRoom
  };
}
