import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { projectInvitePanelMaps } from "../store/slices/inviteSlice";

export function useInvitePanelState() {
  const inviteByRoom = useAppStore((state) => state.inviteByRoom);
  const inviteSecretInput = useAppStore((state) => state.inviteSecretInput);
  const setInviteSecretInputValue = useAppStore((state) => state.setInviteSecretInputValue);
  const clearInviteSecretInput = useAppStore((state) => state.clearInviteSecretInput);

  const {
    inviteRequestsByRoom,
    inviteLinksByRoom,
    inviteApprovalGatesByRoom,
    inviteMessagesByRoom,
    keyRotationBusyByRoom,
    inviteAdmissionsByRoom
  } = useMemo(() => projectInvitePanelMaps(inviteByRoom), [inviteByRoom]);

  return {
    inviteByRoom,
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
