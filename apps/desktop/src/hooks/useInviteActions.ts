import { createInviteJoinActions } from "../lib/invite/inviteJoinActions";
import { createInviteLinkActions } from "../lib/invite/inviteLinkActions";
import { createInviteRelayActions } from "../lib/invite/inviteRelayActions";
import { createRoomKeyRotationActions } from "../lib/invite/roomKeyRotationActions";
import type { UseInviteActionsOptions } from "../lib/invite/inviteActionTypes";
import { useCallback, useMemo, useRef } from "react";

export function useInviteActions(options: UseInviteActionsOptions) {
  const relayActions = createInviteRelayActions(options);
  const joinActions = createInviteJoinActions({
    ...options,
    publishInviteJoinRequest: relayActions.publishInviteJoinRequest
  });
  const linkActions = createInviteLinkActions(options);
  const rotationActions = createRoomKeyRotationActions(options);

  const joinInviteSecret = useStableEvent(joinActions.joinInviteSecret);
  const requestNoSecretInviteAccess = useStableEvent(joinActions.requestNoSecretInviteAccess);
  const copyInviteLink = useStableEvent(linkActions.copyInviteLink);
  const decryptInviteEnvelope = useStableEvent(relayActions.decryptInviteEnvelope);
  const decideInviteJoinRequest = useStableEvent(relayActions.decideInviteJoinRequest);
  const handleInviteEnvelopePlaintext = useStableEvent(relayActions.handleInviteEnvelopePlaintext);
  const rotateSelectedRoomKey = useStableEvent(rotationActions.rotateSelectedRoomKey);
  const rotateRoomKeyForDevices = useStableEvent(rotationActions.rotateRoomKeyForDevices);
  return useMemo(
    () => ({
      joinInviteSecret,
      requestNoSecretInviteAccess,
      copyInviteLink,
      decryptInviteEnvelope,
      decideInviteJoinRequest,
      handleInviteEnvelopePlaintext,
      rotateSelectedRoomKey,
      rotateRoomKeyForDevices
    }),
    [
      joinInviteSecret,
      requestNoSecretInviteAccess,
      copyInviteLink,
      decryptInviteEnvelope,
      decideInviteJoinRequest,
      handleInviteEnvelopePlaintext,
      rotateSelectedRoomKey,
      rotateRoomKeyForDevices
    ]
  );
}

/** Keeps effect-facing invite handlers stable while reading each render's action factory output. */
function useStableEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  latest.current = callback;
  return useCallback((...args: Args) => latest.current(...args), []);
}
