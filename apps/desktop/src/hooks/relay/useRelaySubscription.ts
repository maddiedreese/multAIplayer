import { useEffect, type MutableRefObject } from "react";
import type { ClientRoomRecord, RelayServerMessage, TeamRecord } from "@multaiplayer/protocol";
import { connectRelay, type RelayClient } from "../../lib/relay/relayClient";
import { trustedAvatarUrl } from "../../lib/core/avatarUrl";
import { ensureRoomDefaults } from "../../lib/room/roomDefaults";
import { useAppStore } from "../../store/appStore";
import type { RoomPresence } from "../../types";
import type { HandleCodexBrowserOpenCommand } from "../../application/codex/codexBrowserOpenCommand";
import { useLatestRef } from "../useLatestRef";
import { recoverAuthenticatedHostTransfer, routeMlsMessage } from "./routeMlsMessage";
import { handleExactLocalMlsReplay } from "./mlsReplay";
import {
  currentMlsEpoch,
  listMlsJoinAdmissions,
  listPendingMlsInviteRequests,
  isMlsRequiresRejoin,
  forgetCorruptMlsGroup,
  openMlsGroup
} from "../../lib/mls/mlsClient";
import { pendingMlsOutboxRoomIds, recoverRoomAfterJoin } from "../../application/mls/mlsOutboxDrain";
import {
  completeMlsRelayAdmission,
  coordinateMlsAdmissionRecoveryWithRetry,
  projectMlsAdmissionInviteRequest,
  synchronizeMlsRecoverySelection
} from "../../application/mls/mlsJoinAdmission";
import { reportExpectedFailure, reportNonFatal } from "../../lib/core/nonFatalReporting";
import { getRelayHttpUrl } from "../../lib/core/appConfig";
import { recoverDeviceSessionForRelayError } from "../../lib/identity/deviceSession";
import {
  canContinueSelectedWorkspaceAfterAdmissionRecovery,
  runRelayWorkspaceStartupBarrier
} from "../../lib/relay/relayWorkspaceStartup";

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
  selectedRoom: ClientRoomRecord | null;
  hasSelectedRoom: boolean;
  inviteAdmissionsByRoom: Record<string, string | undefined>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  roomsRef: MutableRefObject<ClientRoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  markIncomingChatUnread: (
    roomId: string,
    selectedRoomId: string,
    senderDeviceId: string,
    localDeviceId: string
  ) => void;
  handleRelayError: (error: Extract<RelayServerMessage, { type: "error" }>) => void;
  upsertRoom: (room: ClientRoomRecord) => void;
  upsertTeam: (team: TeamRecord) => void;
  refreshTeamMembers: (teamId: string, quiet?: boolean) => Promise<void>;
  handleInviteRequested: (inviteId: string) => Promise<void>;
  handleCodexBrowserOpenCommand: HandleCodexBrowserOpenCommand;
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
  const selectedRoomInviteAdmission = selectedRoom ? inviteAdmissionsByRoom[selectedRoom.id] : undefined;

  useEffect(() => {
    let cancelled = false;
    let socketGeneration = 0;
    let workspaceStartupGeneration: number | null = null;
    const roomReceiveQueues = new Map<string, Promise<void>>();
    useAppStore.getState().clearPresenceByRoom();
    if (!relayWsUrl || !deviceSessionToken) {
      useAppStore.getState().replaceRelayStatus("closed");
      relayRef.current = null;
      return;
    }
    const continueSelectedWorkspace = (openClient: RelayClient, isCurrent: () => boolean) => {
      if (!isCurrent()) return;
      const current = latest.current;
      const access = useAppStore.getState();
      const teamId = access.selectedTeam;
      const room = access.rooms.find((candidate) => candidate.id === access.selectedRoomId);
      if (teamId && !access.revokedTeamIds.has(teamId)) {
        openClient.publish({
          type: "subscribe.team",
          teamId,
          userId: current.localUser.id,
          deviceId: current.deviceId
        });
      }
      if (!isCurrent()) return;
      if (!room || access.revokedRoomIds.has(room.id) || access.revokedTeamIds.has(room.teamId)) return;
      void openMlsGroup(room.id)
        .then(() => {
          if (!isCurrent()) return;
          const fresh = latest.current;
          const freshStore = useAppStore.getState();
          if (freshStore.selectedRoomId !== room.id) return;
          openClient.publish({
            type: "join",
            teamId: room.teamId,
            roomId: room.id,
            userId: fresh.localUser.id,
            deviceId: fresh.deviceId,
            deviceSessionToken: fresh.deviceSessionToken,
            inviteId: freshStore.inviteByRoom[room.id]?.admission
          });
          openClient.publish({
            type: "presence",
            teamId: room.teamId,
            roomId: room.id,
            userId: fresh.localUser.id,
            deviceId: fresh.deviceId,
            displayName: fresh.localUser.name,
            avatarUrl: fresh.localUser.avatarUrl,
            publicKeyFingerprint: fresh.devicePublicKeyFingerprint
          });
        })
        .catch((error) => {
          if (!isCurrent()) return;
          if (isMlsRequiresRejoin(error)) {
            void forgetCorruptMlsGroup(room.id)
              .then(() => {
                if (!isCurrent()) return;
                useAppStore.getState().rememberForgottenRoom(room.id);
                useAppStore
                  .getState()
                  .setHostMessageForRoom(
                    room.id,
                    "Local MLS state was corrupt and has been removed. Ask the host to remove this device's old leaf and issue a fresh invite."
                  );
              })
              .catch((cleanupError) => {
                if (!isCurrent()) return;
                useAppStore
                  .getState()
                  .setHostMessageForRoom(
                    room.id,
                    `Local MLS state is corrupt, but its rejoin cleanup failed: ${String(cleanupError)}`
                  );
              });
          }
          // Missing group state belongs to a pending invite; transient failures retry on reconnect.
        });
    };
    const client = connectRelay(
      relayWsUrl,
      async (message) => {
        if (cancelled) return;
        const current = latest.current;
        const store = useAppStore.getState();
        if (message.type === "joined" || message.type === "workspace.subscribed") {
          store.replaceRelayStatus("open");
          if (message.type === "workspace.subscribed") {
            // A relay acknowledgement may be replayed, but admission recovery and
            // selection continuation must run only once for each socket opening.
            if (workspaceStartupGeneration === socketGeneration) return;
            const startupGeneration = socketGeneration;
            workspaceStartupGeneration = startupGeneration;
            const isCurrent = () => !cancelled && socketGeneration === startupGeneration;
            let recoveryFailureReported = false;
            void runRelayWorkspaceStartupBarrier({
              recoverAdmissions: async () => {
                let admissions: Awaited<ReturnType<typeof listMlsJoinAdmissions>>;
                try {
                  admissions = await listMlsJoinAdmissions();
                } catch (error) {
                  if (isCurrent()) {
                    recoveryFailureReported = true;
                    reportExpectedFailure("enumerate durable MLS admissions during workspace startup");
                  }
                  throw error;
                }
                if (!isCurrent()) return;
                const result = await coordinateMlsAdmissionRecoveryWithRetry({
                  admissions,
                  requesterUserId: current.localUser.id,
                  requesterDeviceId: current.deviceId,
                  loadPendingRequests: listPendingMlsInviteRequests,
                  isCurrent,
                  complete: async (admission, pendingRequests) => {
                    await completeMlsRelayAdmission(client, admission, current.deviceSessionToken, async () => {
                      if (!isCurrent()) throw new Error("Workspace startup was superseded by a newer relay socket.");
                      store.restoreWorkspaceAccess(admission.teamId, admission.roomId);
                      store.restoreForgottenRoom(admission.roomId);
                      synchronizeMlsRecoverySelection(admission, useAppStore.getState());
                      const latestStore = useAppStore.getState();
                      const roomName = current.roomsRef.current.find((room) => room.id === admission.roomId)?.name;
                      const projection = projectMlsAdmissionInviteRequest({
                        admission,
                        pendingRequests,
                        existingRequests: latestStore.inviteByRoom[admission.roomId]?.requests ?? [],
                        requesterName: current.localUser.name,
                        roomName: roomName ?? "this room",
                        append: store.appendInviteRequest,
                        approve: (roomId, requestId) => store.updateInviteRequestStatus(roomId, requestId, "approved")
                      });
                      if (projection === "unavailable") {
                        reportExpectedFailure("durable MLS admission UI projection unavailable");
                      }
                      store.setInviteAdmissionForRoom(admission.roomId, null);
                      store.setInviteMessageForRoom(
                        admission.roomId,
                        `The host approved this device.${roomName ? ` ${roomName}` : " This room"} is now unlocked.`
                      );
                      // Keep the durable receipt if this socket is superseded before
                      // the native completion step resumes after this callback.
                      await Promise.resolve();
                      if (!isCurrent()) throw new Error("Workspace startup was superseded by a newer relay socket.");
                    });
                  },
                  onFailure: (admission) => {
                    if (!isCurrent()) return;
                    recoveryFailureReported = true;
                    reportExpectedFailure("complete a durable MLS admission during workspace startup");
                    store.setInviteMessageForRoom(
                      admission.roomId,
                      "This room's persisted MLS admission is awaiting relay confirmation and will retry after reconnecting."
                    );
                  }
                });
                const freshSelection = useAppStore.getState();
                if (
                  !canContinueSelectedWorkspaceAfterAdmissionRecovery({
                    failedAdmissions: result.failedAdmissions,
                    selectedTeamId: freshSelection.selectedTeam,
                    selectedRoomId: freshSelection.selectedRoomId
                  })
                ) {
                  throw new Error("The selected workspace still has an incomplete durable MLS admission.");
                }
              },
              continueSelection: () => continueSelectedWorkspace(client, isCurrent),
              onRecoveryFailure: () => {
                if (!recoveryFailureReported) {
                  reportExpectedFailure("recover durable MLS admissions before workspace subscription");
                }
              },
              isCurrent
            });
            void pendingMlsOutboxRoomIds().then((roomIds) => {
              if (!isCurrent()) return;
              for (const roomId of roomIds) {
                if (roomId === current.selectedRoom?.id) continue;
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
              try {
                await recoverRoomAfterJoin(
                  client,
                  room,
                  {
                    userId: current.localUser.id,
                    deviceId: current.deviceId,
                    deviceSessionToken: current.deviceSessionToken
                  },
                  seenEnvelopeIds.current
                );
              } catch {
                store.setHostMessageForRoom(
                  room.id,
                  "A durable MLS message is still pending relay delivery and will retry after reconnecting."
                );
              }
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
            current.handleRelayError({ type: "error", message: `Device session recovery failed: ${String(error)}` });
            return;
          }
          current.handleRelayError(message);
          return;
        }
        if (message.type === "presence") {
          store.setRoomPresenceForDevice(message.roomId, message.deviceId, onlineRoomPresence(message));
          return;
        }
        if (message.type === "room.updated") {
          const previous = current.roomsRef.current.find((room) => room.id === message.room.id);
          current.upsertRoom(ensureRoomDefaults(message.room, previous));
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
          .catch((error) => reportNonFatal("complete the previous MLS room receive task", error))
          .then(async () => {
            if (cancelled || seenEnvelopeIds.current.has(message.message.id)) return;
            try {
              if (
                await handleExactLocalMlsReplay(
                  message.message,
                  { userId: current.localUser.id, deviceId: current.deviceId },
                  recoverAuthenticatedHostTransfer
                )
              ) {
                seenEnvelopeIds.current.add(message.message.id);
                return;
              }
              const epoch = await currentMlsEpoch(roomId);
              if (message.message.messageType === "commit" && message.message.epochHint < epoch) {
                if (message.message.commitEffect === "host_handoff") {
                  await recoverAuthenticatedHostTransfer(message.message);
                }
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
                markIncomingChatUnread: current.markIncomingChatUnread,
                handleCodexBrowserOpenCommand: current.handleCodexBrowserOpenCommand
              });
              seenEnvelopeIds.current.add(message.message.id);
            } catch (error) {
              reportNonFatal("authenticate or apply an incoming MLS message", error);
              store.setHostMessageForRoom(
                roomId,
                "Security warning: an MLS message could not be authenticated or applied in epoch order. Rejoin this room if the warning persists."
              );
            }
          });
        roomReceiveQueues.set(roomId, queued);
        await queued.finally(() => {
          if (roomReceiveQueues.get(roomId) === queued) roomReceiveQueues.delete(roomId);
        });
      },
      (status) => useAppStore.getState().replaceRelayStatus(status),
      (openClient) => {
        socketGeneration += 1;
        workspaceStartupGeneration = null;
        const current = latest.current;
        openClient.publish({
          type: "subscribe.workspace",
          userId: current.localUser.id,
          deviceId: current.deviceId
        });
      }
    );

    relayRef.current = client;
    return () => {
      cancelled = true;
      socketGeneration += 1;
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
    selectedRoom?.id,
    selectedRoomInviteAdmission,
    selectedRoom?.teamId,
    selectedTeam
  ]);
}

function onlineRoomPresence(message: Extract<RelayServerMessage, { type: "presence" }>): RoomPresence | null {
  if (message.status === "offline") return null;
  const avatarUrl = trustedAvatarUrl(message.avatarUrl);
  return {
    userId: message.userId,
    deviceId: message.deviceId,
    displayName: message.displayName,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(message.publicKeyFingerprint ? { publicKeyFingerprint: message.publicKeyFingerprint } : {}),
    status: message.status
  };
}
