import { createInviteJoinActions } from "../lib/invite/inviteJoinActions";
import { createInviteLinkActions } from "../lib/invite/inviteLinkActions";
import { createInviteRelayActions } from "../lib/invite/inviteRelayActions";
import { createMembershipCommitActions } from "../lib/invite/membershipCommitActions";
import type { UseInviteActionsOptions } from "../lib/invite/inviteActionTypes";
import { useCallback, useMemo, useRef } from "react";

export function useInviteActions(options: UseInviteActionsOptions) {
  const relayActions = createInviteRelayActions(options);
  const joinActions = createInviteJoinActions(options);
  const linkActions = createInviteLinkActions(options);
  const membershipActions = createMembershipCommitActions(options);

  const joinInviteSecret = useStableEvent(joinActions.joinInviteSecret);
  const requestNoSecretInviteAccess = useStableEvent(joinActions.requestNoSecretInviteAccess);
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

/** Keeps effect-facing invite handlers stable while reading each render's action factory output. */
function useStableEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Args) => latest.current(...args), []);
}
