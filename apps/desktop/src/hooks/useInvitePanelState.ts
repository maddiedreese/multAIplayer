import { useState } from "react";
import type { InviteJoinRequest } from "../types";

export function useInvitePanelState() {
  const [inviteRequestsByRoom, setInviteRequestsByRoom] = useState<Record<string, InviteJoinRequest[]>>({});
  const [inviteSecretInput, setInviteSecretInput] = useState("");
  const [inviteLinksByRoom, setInviteLinksByRoom] = useState<Record<string, string>>({});
  const [inviteApprovalGatesByRoom, setInviteApprovalGatesByRoom] = useState<Record<string, boolean>>({});
  const [inviteMessagesByRoom, setInviteMessagesByRoom] = useState<Record<string, string | null>>({});
  const [keyRotationBusyByRoom, setKeyRotationBusyByRoom] = useState<Record<string, boolean>>({});
  const [inviteAdmissionsByRoom, setInviteAdmissionsByRoom] = useState<Record<string, string>>({});

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
