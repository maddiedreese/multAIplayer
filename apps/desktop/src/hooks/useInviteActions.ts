import { createInviteJoinActions } from "../lib/invite/inviteJoinActions";
import { createInviteLinkActions } from "../lib/invite/inviteLinkActions";
import { createInviteRelayActions } from "../lib/invite/inviteRelayActions";
import { createMembershipCommitActions } from "../lib/invite/membershipCommitActions";
import type { UseInviteActionsOptions } from "../lib/invite/inviteActionTypes";
import { reportExpectedFailure } from "../lib/nonFatalReporting";
import { useAppStore } from "../store/appStore";
import { useCallback, useEffect, useMemo, useRef } from "react";

export function useInviteActions(options: UseInviteActionsOptions) {
  const relayActions = createInviteRelayActions(options);
  const joinActions = createInviteJoinActions(options);
  const linkActions = createInviteLinkActions(options);
  const membershipActions = createMembershipCommitActions(options);

  const joinInviteSecret = useStableEvent(joinActions.joinInviteSecret);
  const requestNoSecretInviteAccess = useStableEvent(joinActions.requestNoSecretInviteAccess);
  const resumePendingInviteRequests = useStableEvent(joinActions.resumePendingInviteRequests);
  usePendingInviteRecovery(resumePendingInviteRequests);
  const copyInviteLink = useStableEvent(linkActions.copyInviteLink);
  const decideInviteJoinRequest = useStableEvent(relayActions.decideInviteJoinRequest);
  const handleInviteRequested = useStableEvent(relayActions.handleInviteRequested);
  const removeMembersFromMlsGroup = useStableEvent(membershipActions.removeMembersFromMlsGroup);
  return useMemo(
    () => ({
      joinInviteSecret,
      requestNoSecretInviteAccess,
      copyInviteLink,
      decideInviteJoinRequest,
      handleInviteRequested,
      removeMembersFromMlsGroup
    }),
    [
      joinInviteSecret,
      requestNoSecretInviteAccess,
      copyInviteLink,
      decideInviteJoinRequest,
      handleInviteRequested,
      removeMembersFromMlsGroup
    ]
  );
}

export function usePendingInviteRecovery(resumePendingInviteRequests: () => Promise<void>) {
  const deviceSessionToken = useAppStore((state) => state.deviceSessionToken);
  const relayStatus = useAppStore((state) => state.relayStatus);
  const workspaceBootstrapStatus = useAppStore((state) => state.workspaceBootstrapStatus);
  const lastStartedScope = useRef<string | null>(null);

  useEffect(() => {
    if (!deviceSessionToken || relayStatus !== "open" || workspaceBootstrapStatus !== "ready") {
      lastStartedScope.current = null;
      return;
    }
    const scope = deviceSessionToken;
    if (lastStartedScope.current === scope) return;
    lastStartedScope.current = scope;
    void resumePendingInviteRequests().catch(() => {
      reportExpectedFailure("pending invite recovery deferred until reconnect");
    });
  }, [deviceSessionToken, relayStatus, resumePendingInviteRequests, workspaceBootstrapStatus]);
}

/** Keeps effect-facing invite handlers stable while reading each render's action factory output. */
function useStableEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Args) => latest.current(...args), []);
}
