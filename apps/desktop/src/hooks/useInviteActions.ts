import { createInviteJoinActions } from "../lib/invite/inviteJoinActions";
import { createInviteLinkActions } from "../lib/invite/inviteLinkActions";
import { createInviteRelayActions } from "../lib/invite/inviteRelayActions";
import { createRoomKeyRotationActions } from "../lib/invite/roomKeyRotationActions";
import type { UseInviteActionsOptions } from "../lib/invite/inviteActionTypes";
import { useStablePlainObjectComposition } from "./useStablePlainObjectComposition";

export function useInviteActions(options: UseInviteActionsOptions) {
  const relayActions = createInviteRelayActions(options);
  const joinActions = createInviteJoinActions({
    ...options,
    publishInviteJoinRequest: relayActions.publishInviteJoinRequest
  });
  const linkActions = createInviteLinkActions(options);
  const rotationActions = createRoomKeyRotationActions(options);

  return useStablePlainObjectComposition({
    ...joinActions,
    ...linkActions,
    decryptInviteEnvelope: relayActions.decryptInviteEnvelope,
    decideInviteJoinRequest: relayActions.decideInviteJoinRequest,
    handleInviteEnvelopePlaintext: relayActions.handleInviteEnvelopePlaintext,
    ...rotationActions
  });
}
