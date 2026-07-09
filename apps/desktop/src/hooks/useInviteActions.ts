import { useAppStore } from "../store/appStore";
import { createInviteJoinActions } from "./inviteJoinActions";
import { createInviteLinkActions } from "./inviteLinkActions";
import { createInviteRelayActions } from "./inviteRelayActions";
import { createRoomKeyRotationActions } from "./roomKeyRotationActions";
import type { UseInviteActionsOptions } from "./inviteActionTypes";

export function useInviteActions(options: UseInviteActionsOptions) {
  const setInviteAdmissionForRoom = useAppStore((state) => state.setInviteAdmissionForRoom);
  const initializeMessagesForRoom = useAppStore((state) => state.initializeMessagesForRoom);

  const relayActions = createInviteRelayActions(options);
  const joinActions = createInviteJoinActions({
    ...options,
    initializeMessagesForRoom,
    publishInviteJoinRequest: relayActions.publishInviteJoinRequest,
    setInviteAdmissionForRoom
  });

  return {
    ...joinActions,
    ...createInviteLinkActions(options),
    decryptInviteEnvelope: relayActions.decryptInviteEnvelope,
    decideInviteJoinRequest: relayActions.decideInviteJoinRequest,
    handleInviteEnvelopePlaintext: relayActions.handleInviteEnvelopePlaintext,
    ...createRoomKeyRotationActions(options)
  };
}
