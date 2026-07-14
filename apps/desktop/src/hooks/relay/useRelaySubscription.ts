import { useEffect, type MutableRefObject } from "react";
import type { RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { connectRelay, type RelayClient } from "../../lib/relayClient";
import { trustedAvatarUrl } from "../../lib/avatarUrl";
import { ensureRoomDefaults } from "../../lib/roomDefaults";
import { useAppStore } from "../../store/appStore";
import type { ChatMessage } from "../../types";
import { useLatestRef } from "../useLatestRef";
import { routeMlsMessage } from "./routeMlsMessage";
import {
  currentMlsEpoch,
  listMlsJoinAdmissions,
  isMlsRequiresRejoin,
  forgetCorruptMlsGroup,
  openMlsGroup
} from "../../lib/mlsClient";
import { drainMlsOutboxForRoom, pendingMlsOutboxRoomIds } from "../../lib/mlsOutboxDrain";
import { completeMlsRelayAdmission, synchronizeMlsRecoverySelection } from "../../lib/mlsJoinAdmission";
import { reportNonFatal } from "../../lib/nonFatalReporting";
import { getRelayHttpUrl } from "../../lib/appConfig";
import { recoverDeviceSessionForRelayError } from "../../lib/deviceSession";

interface LocalUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface UseRelaySubscriptionOptions {
  relayWsUrl: string;
  deviceId: string;
  localUser: LocalUser;
  devicePublicKeyFingerprint?: string;
  deviceSessionToken: string;
  selectedTeam: string;
  selectedRoom: RoomRecord;
  hasSelectedRoom: boolean;
  inviteAdmissionsByRoom: Record<string, string | undefined>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  markIncomingChatUnread: (
    roomId: string,
    selectedRoomId: string,
    senderDeviceId: string,
    localDeviceId: string
  ) => void;
  handleRelayError: (message: string) => void;
  upsertRoom: (room: RoomRecord) => void;
  upsertTeam: (team: TeamRecord) => void;
  refreshTeamMembers: (teamId: string, quiet?: boolean) => Promise<void>;
  handleInviteRequested: (inviteId: string) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
}

export function useRelaySubscription(options: UseRelaySubscriptionOptions) {
  const {
    relayWsUrl,
    deviceId,
    localUser,
    devicePublicKeyFingerprint,
    deviceSessionToken,
    selectedTeam,
    selectedRoom,
    hasSelectedRoom,
    inviteAdmissionsByRoom,
    relayRef,
    seenEnvelopeIds
  } = options;
  const latest = useLatestRef(options);
  const selectedRoomInviteAdmission = inviteAdmissionsByRoom[selectedRoom.id];

  useEffect(() => {
    let cancelled = false;
    const roomReceiveQueues = new Map<string, Promise<void>>();
    useAppStore.getState().clearPresenceByRoom();
    if (!relayWsUrl || !deviceSessionToken) {
      useAppStore.getState().replaceRelayStatus("closed");
      relayRef.current = null;
      return;
    }
    const client = connectRelay(
      relayWsUrl,
      async (message) => {
        if (cancelled) return;
        const current = latest.current;
        const store = useAppStore.getState();
        if (message.type === "joined" || message.type === "workspace.subscribed") {
          store.replaceRelayStatus("open");
          if (message.type === "workspace.subscribed") {
            void listMlsJoinAdmissions()
              .then(async (admissions) => {
                for (const admission of admissions) {
                  if (
                    admission.requesterUserId !== current.localUser.id ||
                    admission.requesterDeviceId !== current.deviceId
                  )
                    continue;
                  await completeMlsRelayAdmission(client, admission, current.deviceSessionToken, () => {
                    store.restoreWorkspaceAccess(admission.teamId, admission.roomId);
                    store.restoreForgottenRoom(admission.roomId);
                    synchronizeMlsRecoverySelection(admission, useAppStore.getState());
                    store.updateInviteRequestStatus(admission.roomId, admission.requestId, "approved");
                    store.setInviteAdmissionForRoom(admission.roomId, null);
                    const roomName = current.roomsRef.current.find((room) => room.id === admission.roomId)?.name;
                    store.setInviteMessageForRoom(
                      admission.roomId,
                      `The host approved this device.${roomName ? ` ${roomName}` : " This room"} is now unlocked.`
                    );
                  });
                }
                if (admissions.length > 0 && current.hasSelectedRoom) {
                  await client.joinAndWaitForAck({
                    type: "join",
                    teamId: current.selectedRoom.teamId,
                    roomId: current.selectedRoom.id,
                    userId: current.localUser.id,
                    deviceId: current.deviceId,
                    deviceSessionToken: current.deviceSessionToken
                  });
                }
              })
              .catch(() => {
                store.setInviteMessageForRoom(
                  current.selectedRoom.id,
                  "A persisted MLS admission is awaiting relay confirmation and will retry after reconnecting."
                );
              });
            void pendingMlsOutboxRoomIds().then((roomIds) => {
              for (const roomId of roomIds) {
                if (roomId === current.selectedRoom.id) continue;
                store.setHostMessageForRoom(
                  roomId,
                  "This room has a durable MLS message awaiting delivery. Select the room while connected to retry it."
                );
              }
            });
          }
          if (message.type === "joined") {
            const room = current.roomsRef.current.find((candidate) => candidate.id === message.roomId);
            if (room) {
              void drainMlsOutboxForRoom(client, room, {
                userId: current.localUser.id,
                deviceId: current.deviceId,
                deviceSessionToken: current.deviceSessionToken
              }).catch(() => {
                store.setHostMessageForRoom(
                  room.id,
                  "A durable MLS message is still pending relay delivery and will retry after reconnecting."
                );
              });
            }
          }
          return;
        }
        if (message.type === "team.subscribed") return;
        if (message.type === "invite.requested") {
          await current.handleInviteRequested(message.inviteId);
          return;
        }
        if (message.type === "error") {
          try {
            if (
              await recoverDeviceSessionForRelayError(
                message,
                getRelayHttpUrl(),
                current.deviceId,
                current.deviceSessionToken,
                (session) => {
                  if (!cancelled) useAppStore.getState().replaceDeviceSessionToken(session.token);
                }
              )
            )
              return;
          } catch (error) {
            current.handleRelayError(`Device session recovery failed: ${String(error)}`);
            return;
          }
          current.handleRelayError(message.message);
          return;
        }
        if (message.type === "presence") {
          store.setRoomPresenceForDevice(
            message.roomId,
            message.deviceId,
            message.status === "offline"
              ? null
              : {
                  userId: message.userId,
                  deviceId: message.deviceId,
                  displayName: message.displayName,
                  avatarUrl: trustedAvatarUrl(message.avatarUrl),
                  publicKeyFingerprint: message.publicKeyFingerprint,
                  status: message.status
                }
          );
          return;
        }
        if (message.type === "room.updated") {
          current.upsertRoom(ensureRoomDefaults(message.room));
          return;
        }
        if (message.type === "team.updated") {
          current.upsertTeam(message.team);
          void current.refreshTeamMembers(message.team.id, false);
          return;
        }
        if (message.type !== "mls.message" || seenEnvelopeIds.current.has(message.message.id)) return;
        const roomId = message.message.roomId;
        const previous = roomReceiveQueues.get(roomId) ?? Promise.resolve();
        const queued = previous
          .catch(() => reportNonFatal("complete the previous MLS room receive task"))
          .then(async () => {
            if (cancelled || seenEnvelopeIds.current.has(message.message.id)) return;
            try {
              const epoch = await currentMlsEpoch(roomId);
              if (message.message.messageType === "commit" && message.message.epochHint < epoch) {
                seenEnvelopeIds.current.add(message.message.id);
                return;
              }
              if (message.message.epochHint > epoch) {
                throw new Error("A prior MLS epoch transition is missing on this device.");
              }
              await routeMlsMessage(message.message, {
                deviceId: current.deviceId,
                localUser: current.localUser,
                roomsRef: current.roomsRef,
                selectedRoomIdRef: current.selectedRoomIdRef,
                historyLoadedRoomIds: current.historyLoadedRoomIds,
                markIncomingChatUnread: current.markIncomingChatUnread,
                handleCodexBrowserOpenCommand: current.handleCodexBrowserOpenCommand
              });
              seenEnvelopeIds.current.add(message.message.id);
            } catch {
              reportNonFatal("authenticate or apply an incoming MLS message");
              store.setHostMessageForRoom(
                roomId,
                "Security warning: an MLS message could not be authenticated or applied in epoch order. Rejoin this room if the warning persists."
              );
            }
          });
        roomReceiveQueues.set(roomId, queued);
        void queued.finally(() => {
          if (roomReceiveQueues.get(roomId) === queued) roomReceiveQueues.delete(roomId);
        });
      },
      (status) => useAppStore.getState().replaceRelayStatus(status),
      (openClient) => {
        openClient.publish({
          type: "subscribe.workspace",
          userId: localUser.id,
          deviceId
        });
        const access = useAppStore.getState();
        if (selectedTeam && !access.revokedTeamIds.has(selectedTeam)) {
          openClient.publish({
            type: "subscribe.team",
            teamId: selectedTeam,
            userId: localUser.id,
            deviceId
          });
        }
        if (
          !hasSelectedRoom ||
          access.revokedRoomIds.has(selectedRoom.id) ||
          access.revokedTeamIds.has(selectedRoom.teamId)
        )
          return;
        void openMlsGroup(selectedRoom.id)
          .then(() => {
            openClient.publish({
              type: "join",
              teamId: selectedRoom.teamId,
              roomId: selectedRoom.id,
              userId: localUser.id,
              deviceId,
              deviceSessionToken,
              inviteId: selectedRoomInviteAdmission
            });
            openClient.publish({
              type: "presence",
              teamId: selectedRoom.teamId,
              roomId: selectedRoom.id,
              userId: localUser.id,
              deviceId,
              displayName: localUser.name,
              avatarUrl: localUser.avatarUrl,
              publicKeyFingerprint: devicePublicKeyFingerprint
            });
          })
          .catch((error) => {
            if (isMlsRequiresRejoin(error)) {
              void forgetCorruptMlsGroup(selectedRoom.id)
                .then(() => {
                  useAppStore.getState().rememberForgottenRoom(selectedRoom.id);
                  useAppStore
                    .getState()
                    .setHostMessageForRoom(
                      selectedRoom.id,
                      "Local MLS state was corrupt and has been removed. Ask the host to remove this device's old leaf and issue a fresh invite."
                    );
                })
                .catch((cleanupError) => {
                  useAppStore
                    .getState()
                    .setHostMessageForRoom(
                      selectedRoom.id,
                      `Local MLS state is corrupt, but its rejoin cleanup failed: ${String(cleanupError)}`
                    );
                });
            }
            // Missing group state belongs to a pending invite; transient failures retry on reconnect.
          });
      }
    );

    relayRef.current = client;
    return () => {
      cancelled = true;
      relayRef.current = null;
      client.close();
    };
  }, [
    relayWsUrl,
    deviceId,
    deviceSessionToken,
    devicePublicKeyFingerprint,
    hasSelectedRoom,
    latest,
    localUser.avatarUrl,
    localUser.id,
    localUser.name,
    relayRef,
    seenEnvelopeIds,
    selectedRoom.id,
    selectedRoomInviteAdmission,
    selectedRoom.teamId,
    selectedTeam
  ]);
}
