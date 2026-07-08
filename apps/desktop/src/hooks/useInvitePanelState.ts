import { useMemo } from "react";
import { useAppStore } from "../store/appStore";

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
  } = useMemo(() => ({
    inviteRequestsByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.requests)
        .map(([roomId, invite]) => [roomId, invite.requests ?? []])
    ),
    inviteLinksByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.link)
        .map(([roomId, invite]) => [roomId, invite.link ?? ""])
    ),
    inviteApprovalGatesByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.approvalGate)
        .map(([roomId]) => [roomId, true])
    ),
    inviteMessagesByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.message)
        .map(([roomId, invite]) => [roomId, invite.message ?? null])
    ),
    keyRotationBusyByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.keyRotationBusy)
        .map(([roomId]) => [roomId, true])
    ),
    inviteAdmissionsByRoom: Object.fromEntries(
      Object.entries(inviteByRoom)
        .filter(([, invite]) => invite.admission)
        .map(([roomId, invite]) => [roomId, invite.admission])
    )
  }), [inviteByRoom]);

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
