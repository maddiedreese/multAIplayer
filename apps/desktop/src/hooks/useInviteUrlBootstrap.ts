import { useEffect } from "react";
import { readInviteUrlPayload } from "../lib/inviteUrl";

interface UseInviteUrlBootstrapOptions {
  requestNoSecretInviteAccess: (encodedInvite: string, inviteId?: string | null) => Promise<void>;
  setSelectedInviteMessage: (message: string | null) => void;
}

export function useInviteUrlBootstrap({
  requestNoSecretInviteAccess,
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

    setSelectedInviteMessage(
      "This legacy invite contains a room key and is no longer accepted. Ask the active host for a new invite."
    );
  }, [requestNoSecretInviteAccess, setSelectedInviteMessage]);
}
