import { useAppStore } from "../store/appStore";

export function useInvitePanelState() {
  const inviteRequestsByRoom = useAppStore((state) => state.inviteRequestsByRoom);
  const inviteSecretInput = useAppStore((state) => state.inviteSecretInput);
  const setInviteSecretInputValue = useAppStore((state) => state.setInviteSecretInputValue);
  const clearInviteSecretInput = useAppStore((state) => state.clearInviteSecretInput);
  const inviteLinksByRoom = useAppStore((state) => state.inviteLinksByRoom);
  const inviteApprovalGatesByRoom = useAppStore((state) => state.inviteApprovalGatesByRoom);
  const inviteMessagesByRoom = useAppStore((state) => state.inviteMessagesByRoom);
  const keyRotationBusyByRoom = useAppStore((state) => state.keyRotationBusyByRoom);
  const inviteAdmissionsByRoom = useAppStore((state) => state.inviteAdmissionsByRoom);

  return {
    inviteRequestsByRoom,
    inviteSecretInput,
    setInviteSecretInputValue,
    clearInviteSecretInput,
    inviteLinksByRoom,
    inviteApprovalGatesByRoom,
    inviteMessagesByRoom,
    keyRotationBusyByRoom,
    inviteAdmissionsByRoom
  };
}
