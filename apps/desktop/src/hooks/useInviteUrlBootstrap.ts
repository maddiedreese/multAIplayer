import { useEffect } from "react";
import { readInviteUrlPayload } from "../lib/inviteUrl";

interface UseInviteUrlBootstrapOptions {
  requestNoSecretInviteAccess: (encodedInvite: string, inviteId?: string | null) => Promise<void>;
  acceptInvite: (encodedSecret: string, inviteId?: string | null, approvalRequested?: boolean) => Promise<void>;
  setSelectedInviteMessage: (message: string | null) => void;
}

export function useInviteUrlBootstrap({
  requestNoSecretInviteAccess,
  acceptInvite,
  setSelectedInviteMessage
}: UseInviteUrlBootstrapOptions) {
  useEffect(() => {
    const invitePayload = readInviteUrlPayload(window.location);
    if (!invitePayload) return;
    window.history.replaceState(null, "", invitePayload.cleanupPath);
    if (invitePayload.kind === "join") {
      requestNoSecretInviteAccess(invitePayload.encoded, invitePayload.inviteId).catch((error) =>
        setSelectedInviteMessage(`Invite could not be read: ${String(error)}`)
      );
      return;
    }

    acceptInvite(invitePayload.encoded, invitePayload.inviteId, invitePayload.approvalRequested).catch((error) =>
      setSelectedInviteMessage(`Invite could not be read: ${String(error)}`)
    );
  }, [acceptInvite, requestNoSecretInviteAccess, setSelectedInviteMessage]);
}
