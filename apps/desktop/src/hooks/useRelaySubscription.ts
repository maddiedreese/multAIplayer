import { useEffect, useRef, type MutableRefObject } from "react";
import type {
  BrowserRequestPlaintextPayload,
  ChatDeletePlaintextPayload,
  ChatEditPlaintextPayload,
  CodexApprovalPlaintextPayload,
  CodexQueuePlaintextPayload,
  ChatPlaintextPayload,
  ChatReactionPlaintextPayload,
  GitHubActionsEventPlaintextPayload,
  GitWorkflowEventPlaintextPayload,
  HostHandoffPlaintextPayload,
  RelayEnvelope,
  RequestStatusPlaintextPayload,
  RoomRecord,
  TeamRecord,
  TerminalRequestPlaintextPayload
} from "@multaiplayer/protocol";
import { decryptJson } from "@multaiplayer/crypto";
import { connectRelay, type RelayClient } from "../lib/relayClient";
import { buildRoomSettingsSystemMessage } from "../lib/roomSettingsMessages";
import { loadRoomSecret, replaceRoomSecret } from "../lib/localHistory";
import { trustedAvatarUrl } from "../lib/avatarUrl";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { normalizeChatMessage } from "../lib/chatSanitizer";
import {
  buildCodexEventLine,
  buildGitHubActionsEventLines,
  buildGitWorkflowEventLines,
  buildTerminalResultLines
} from "../lib/activityLines";
import {
  isChatReactionPlaintextPayload,
  isChatDeletePlaintextPayload,
  isChatEditPlaintextPayload,
  isCodexApprovalPlaintextPayload,
  isCodexEventPlaintextPayload,
  isCodexQueuePlaintextPayload,
  isGitHubActionsEventPlaintextPayload,
  isGitWorkflowEventPlaintextPayload,
  isLegacyDebugChatMessage,
  isLocalPreviewPlaintextPayload,
  isRequestStatusPlaintextPayload,
  isRoomKeyRotationPlaintextPayload,
  isRoomSettingsPlaintextPayload,
  isTerminalResultPlaintextPayload,
  isWorkspaceFileSaveRequestPlaintextPayload
} from "../lib/localRoomHistoryPayload";
import { formatMessageTime } from "../lib/appFormatters";
import { isRoomKeyRotationEnvelopeAuthorized } from "../lib/roomKeyRotation";
import {
  findEnvelopeRoom,
  isEnvelopeFromActiveRoomHost,
  roomHostEnvelopeRejectionMessage
} from "../lib/roomHost";
import { sendRoomMessageNotification } from "../lib/roomNotifications";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  LocalPreviewRecord,
  QueuedCodexTurn,
  RelayStatus,
  RoomPresence,
  TerminalCommandRequest,
  WorkspaceFileSaveRequest
} from "../types";

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
  selectedTeam: string;
  selectedRoom: RoomRecord;
  hasSelectedRoom: boolean;
  isActiveHost: boolean;
  inviteAdmissionsByRoom: Record<string, string | undefined>;
  mutedRoomIds: Set<string>;
  forgottenRoomIds: Set<string>;
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  approvalPolicyLabels: Record<string, string>;
  approvalDelegationPolicyLabels: Record<string, string>;
  roomModeLabels: Record<string, string>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  replaceRelayStatus: (status: RelayStatus) => void;
  clearPresenceByRoom: () => void;
  setRoomPresenceForDevice: (roomId: string, deviceId: string, presence: RoomPresence | null) => void;
  markIncomingChatUnread: (roomId: string, selectedRoomId: string, senderDeviceId: string, localDeviceId: string) => void;
  rememberForgottenRoom: (roomId: string) => void;
  restoreForgottenRoom: (roomId: string) => void;
  handleRelayError: (message: string) => void;
  upsertRoom: (room: RoomRecord) => void;
  upsertTeam: (team: TeamRecord) => void;
  refreshTeamMembers: (teamId: string, quiet?: boolean) => Promise<void>;
  decryptInviteEnvelope: (envelope: RelayEnvelope) => Promise<unknown | null>;
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
  handleCodexApprovalEvent: (event: CodexApprovalPlaintextPayload, roomId: string) => void;
  editRoomMessage: (roomId: string, edit: ChatEditPlaintextPayload) => void;
  deleteRoomMessage: (roomId: string, deletion: ChatDeletePlaintextPayload) => void;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
  appendTerminalRequest: (roomId: string, request: TerminalCommandRequest) => void;
  updateTerminalRequestStatus: (roomId: string, requestId: string, status: TerminalCommandRequest["status"]) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  applyGitHubActionsEventForRoom: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  enqueueCodexApprovalForRoom: (roomId: string, turn: QueuedCodexTurn) => void;
  removeQueuedCodexApprovalForRoom: (roomId: string, turnId: string) => void;
  setPendingCodexApprovalForRoom: (roomId: string, approval: null) => void;
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  appendFileSaveRequest: (roomId: string, request: WorkspaceFileSaveRequest) => void;
  updateFileSaveRequestStatus: (roomId: string, requestId: string, status: WorkspaceFileSaveRequest["status"]) => void;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
  applyAcceptedHostHandoffForRoom: (roomId: string, handoff: HostHandoffRecord) => void;
  appendRoomMessage: (roomId: string, message: ChatMessage) => void;
  setInviteMessageForRoom: (roomId: string, message: string | null) => void;
}

export function useRelaySubscription({
  relayWsUrl,
  deviceId,
  localUser,
  devicePublicKeyFingerprint,
  selectedTeam,
  selectedRoom,
  hasSelectedRoom,
  isActiveHost,
  inviteAdmissionsByRoom,
  mutedRoomIds,
  forgottenRoomIds,
  revokedRoomIds,
  revokedTeamIds,
  approvalPolicyLabels,
  approvalDelegationPolicyLabels,
  roomModeLabels,
  relayRef,
  seenEnvelopeIds,
  roomsRef,
  selectedRoomIdRef,
  historyLoadedRoomIds,
  replaceRelayStatus,
  clearPresenceByRoom,
  setRoomPresenceForDevice,
  markIncomingChatUnread,
  rememberForgottenRoom,
  restoreForgottenRoom,
  handleRelayError,
  upsertRoom,
  upsertTeam,
  refreshTeamMembers,
  decryptInviteEnvelope,
  handleInviteEnvelopePlaintext,
  handleCodexBrowserOpenCommand,
  handleCodexApprovalEvent,
  editRoomMessage,
  deleteRoomMessage,
  applyMessageReaction,
  appendTerminalRequest,
  updateTerminalRequestStatus,
  appendTerminalLinesForRoom,
  appendGitWorkflowEvent,
  setGitWorkflowMessageForRoom,
  applyGitHubActionsEventForRoom,
  appendCodexEvent,
  enqueueCodexApprovalForRoom,
  removeQueuedCodexApprovalForRoom,
  setPendingCodexApprovalForRoom,
  setApprovalVisibleForRoom,
  appendBrowserRequest,
  updateBrowserRequestStatus,
  appendFileSaveRequest,
  updateFileSaveRequestStatus,
  appendLocalPreviewEvent,
  setChatMessageForRoom,
  setHostMessageForRoom,
  appendHostHandoff,
  applyAcceptedHostHandoffForRoom,
  appendRoomMessage,
  setInviteMessageForRoom
}: UseRelaySubscriptionOptions) {
  const mutedRoomIdsRef = useRef(mutedRoomIds);
  const forgottenRoomIdsRef = useRef(forgottenRoomIds);
  useEffect(() => {
    mutedRoomIdsRef.current = mutedRoomIds;
    forgottenRoomIdsRef.current = forgottenRoomIds;
  }, [forgottenRoomIds, mutedRoomIds]);

  useEffect(() => {
    void isActiveHost;
    let cancelled = false;
    clearPresenceByRoom();
    const client = connectRelay(
      relayWsUrl,
      async (message) => {
        if (cancelled) return;
        if (message.type === "joined") {
          replaceRelayStatus("open");
          return;
        }
        if (message.type === "team.subscribed") {
          return;
        }
        if (message.type === "workspace.subscribed") {
          replaceRelayStatus("open");
          return;
        }
        if (message.type === "error") {
          handleRelayError(message.message);
          return;
        }
        if (message.type === "presence") {
          setRoomPresenceForDevice(
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
          upsertRoom(ensureRoomDefaults(message.room));
          return;
        }
        if (message.type === "team.updated") {
          upsertTeam(message.team);
          void refreshTeamMembers(message.team.id, false);
          return;
        }
        if (message.type !== "envelope") {
          return;
        }
        if (seenEnvelopeIds.current.has(message.envelope.id)) {
          return;
        }
        seenEnvelopeIds.current.add(message.envelope.id);
        try {
          if (message.envelope.kind === "room.invite") {
            const plaintext = await decryptInviteEnvelope(message.envelope);
            if (plaintext) {
              await handleInviteEnvelopePlaintext(message.envelope.roomId, plaintext);
            }
            return;
          }
          if (message.envelope.payload.algorithm !== "AES-GCM-256") {
            return;
          }
          const roomPayload = message.envelope.payload;
          const secret = await loadRoomSecret(message.envelope.roomId);
          if (!secret) {
            rememberForgottenRoom(message.envelope.roomId);
            return;
          }
          if (message.envelope.kind === "chat.message") {
            const plaintext = await decryptJson<ChatPlaintextPayload>(roomPayload, secret);
            const chatMessage = normalizeChatMessage(plaintext) as ChatMessage | null;
            if (!chatMessage) return;
            if (isLegacyDebugChatMessage(chatMessage)) return;
            markIncomingChatUnread(
              message.envelope.roomId,
              selectedRoomIdRef.current,
              message.envelope.senderDeviceId,
              deviceId
            );
            appendRoomMessage(message.envelope.roomId, chatMessage);
            const envelopeRoom = roomsRef.current.find((room) => room.id === message.envelope.roomId);
            void sendRoomMessageNotification({
              relayOpen: true,
              room: envelopeRoom,
              message: chatMessage,
              selectedRoomId: selectedRoomIdRef.current,
              localDeviceId: deviceId,
              senderDeviceId: message.envelope.senderDeviceId,
              localUserId: localUser.id,
              senderUserId: message.envelope.senderUserId,
              mutedRoomIds: mutedRoomIdsRef.current,
              forgottenRoomIds: forgottenRoomIdsRef.current,
              revokedRoomIds,
              revokedTeamIds
            }).catch((error) => {
              console.warn("Failed to send room notification", error);
            });
            if (envelopeRoom) handleCodexBrowserOpenCommand(chatMessage, envelopeRoom);
          }
          if (message.envelope.kind === "chat.reaction") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isChatReactionPlaintextPayload(plaintext)) {
              applyMessageReaction(message.envelope.roomId, plaintext);
            }
          }
          if (message.envelope.kind === "chat.edit") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isChatEditPlaintextPayload(plaintext)) {
              editRoomMessage(message.envelope.roomId, plaintext);
            }
          }
          if (message.envelope.kind === "chat.delete") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isChatDeletePlaintextPayload(plaintext)) {
              deleteRoomMessage(message.envelope.roomId, plaintext);
            }
          }
          if (message.envelope.kind === "terminal.request") {
            const plaintext = await decryptJson<TerminalRequestPlaintextPayload>(roomPayload, secret);
            appendTerminalRequest(message.envelope.roomId, { ...plaintext, status: "pending" });
          }
          if (message.envelope.kind === "terminal.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRequestStatusPlaintextPayload(plaintext)) {
              updateTerminalRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
            }
            if (isTerminalResultPlaintextPayload(plaintext)) {
              appendTerminalLinesForRoom(message.envelope.roomId, buildTerminalResultLines(plaintext));
            }
          }
          if (message.envelope.kind === "git.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isGitWorkflowEventPlaintextPayload(plaintext)) {
              appendGitWorkflowEvent(message.envelope.roomId, plaintext);
              appendTerminalLinesForRoom(message.envelope.roomId, buildGitWorkflowEventLines(plaintext));
              setGitWorkflowMessageForRoom(message.envelope.roomId, plaintext.message);
            }
            if (isGitHubActionsEventPlaintextPayload(plaintext)) {
              applyGitHubActionsEventForRoom(message.envelope.roomId, plaintext);
              appendTerminalLinesForRoom(message.envelope.roomId, buildGitHubActionsEventLines(plaintext));
            }
          }
          if (message.envelope.kind === "codex.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isCodexEventPlaintextPayload(plaintext)) {
              appendCodexEvent(message.envelope.roomId, plaintext);
              appendTerminalLinesForRoom(message.envelope.roomId, [buildCodexEventLine(plaintext)]);
            }
          }
          if (message.envelope.kind === "codex.approval") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isCodexApprovalPlaintextPayload(plaintext)) {
              handleCodexApprovalEvent(plaintext, message.envelope.roomId);
            }
          }
          if (message.envelope.kind === "codex.queue") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isCodexQueuePlaintextPayload(plaintext)) {
              handleCodexQueueEvent(
                plaintext,
                message.envelope.roomId,
                enqueueCodexApprovalForRoom,
                removeQueuedCodexApprovalForRoom,
                setPendingCodexApprovalForRoom,
                setApprovalVisibleForRoom,
                setHostMessageForRoom
              );
            }
          }
          if (message.envelope.kind === "browser.request") {
            const plaintext = await decryptJson<BrowserRequestPlaintextPayload>(roomPayload, secret);
            appendBrowserRequest(message.envelope.roomId, { ...plaintext, status: "pending" });
          }
          if (message.envelope.kind === "browser.event") {
            const plaintext = await decryptJson<RequestStatusPlaintextPayload>(roomPayload, secret);
            updateBrowserRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
          }
          if (message.envelope.kind === "workspace.request") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isWorkspaceFileSaveRequestPlaintextPayload(plaintext)) {
              appendFileSaveRequest(message.envelope.roomId, { ...plaintext, status: "pending" });
              setChatMessageForRoom(message.envelope.roomId, `${plaintext.requester} requested a file save.`);
            }
          }
          if (message.envelope.kind === "workspace.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRequestStatusPlaintextPayload(plaintext)) {
              updateFileSaveRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
            }
          }
          if (message.envelope.kind === "preview.event") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isLocalPreviewPlaintextPayload(plaintext)) {
              appendLocalPreviewEvent(message.envelope.roomId, plaintext);
              setChatMessageForRoom(
                message.envelope.roomId,
                plaintext.status === "live"
                  ? `${plaintext.sharedBy} shared a local preview.`
                  : plaintext.status === "stopped"
                    ? `${plaintext.sharedBy} stopped sharing a local preview.`
                    : plaintext.message ?? "Local preview status changed."
              );
            }
          }
          if (message.envelope.kind === "room.host") {
            const plaintext = await decryptJson<HostHandoffPlaintextPayload>(roomPayload, secret);
            if (plaintext.status === "accepted") {
              if (plaintext.acceptedByUserId !== message.envelope.senderUserId) {
                setHostMessageForRoom(
                  message.envelope.roomId,
                  "Rejected host handoff acceptance because the sender did not match the accepting user."
                );
                return;
              }
              applyAcceptedHostHandoffForRoom(message.envelope.roomId, { ...plaintext, status: "accepted" });
              setHostMessageForRoom(
                message.envelope.roomId,
                `${plaintext.acceptedBy ?? "A room member"} accepted host handoff from ${plaintext.fromHost}.`
              );
            } else {
              const envelopeRoom = findEnvelopeRoom(roomsRef.current, message.envelope.roomId);
              if (
                !isEnvelopeFromActiveRoomHost(envelopeRoom, message.envelope) ||
                plaintext.fromUserId !== message.envelope.senderUserId
              ) {
                setHostMessageForRoom(
                  message.envelope.roomId,
                  roomHostEnvelopeRejectionMessage(envelopeRoom, "host handoff")
                );
                return;
              }
              appendHostHandoff(message.envelope.roomId, { ...plaintext, status: "available" });
            }
          }
          if (message.envelope.kind === "room.settings") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomSettingsPlaintextPayload(plaintext)) {
              appendRoomMessage(
                message.envelope.roomId,
                buildRoomSettingsSystemMessage(plaintext, {
                  approvalPolicyLabels,
                  approvalDelegationPolicyLabels,
                  roomModeLabels
                })
              );
            }
          }
          if (message.envelope.kind === "room.key") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomKeyRotationPlaintextPayload(plaintext)) {
              const envelopeRoom = findEnvelopeRoom(roomsRef.current, message.envelope.roomId);
              if (!isRoomKeyRotationEnvelopeAuthorized(envelopeRoom, message.envelope, plaintext)) {
                setInviteMessageForRoom(
                  message.envelope.roomId,
                  roomHostEnvelopeRejectionMessage(envelopeRoom, "room access refresh")
                );
                return;
              }
              await replaceRoomSecret(message.envelope.roomId, plaintext.newSecret);
              historyLoadedRoomIds.current.add(message.envelope.roomId);
              restoreForgottenRoom(message.envelope.roomId);
              appendRoomMessage(message.envelope.roomId, {
                id: plaintext.id,
                author: "multAIplayer",
                role: "system",
                body: `${plaintext.rotatedBy} refreshed room access. Future messages and invites use the updated access state.`,
                time: formatMessageTime(plaintext.rotatedAt),
                createdAt: plaintext.rotatedAt
              });
              setInviteMessageForRoom(message.envelope.roomId, `${plaintext.rotatedBy} refreshed room access for future messages.`);
            }
          }
        } catch (error) {
          console.warn("Failed to decrypt relay envelope", error);
        }
      },
      replaceRelayStatus,
      (openClient) => {
        openClient.publish({
          type: "subscribe.workspace",
          userId: localUser.id,
          deviceId
        });
        if (selectedTeam && !revokedTeamIds.has(selectedTeam)) {
          openClient.publish({
            type: "subscribe.team",
            teamId: selectedTeam,
            userId: localUser.id,
            deviceId
          });
        }
        if (!hasSelectedRoom || revokedRoomIds.has(selectedRoom.id) || revokedTeamIds.has(selectedRoom.teamId)) return;
        openClient.publish({
          type: "join",
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          userId: localUser.id,
          deviceId,
          inviteId: inviteAdmissionsByRoom[selectedRoom.id]
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
    hasSelectedRoom,
    isActiveHost,
    localUser.avatarUrl,
    localUser.id,
    localUser.name,
    handleCodexApprovalEvent,
    approvalDelegationPolicyLabels,
    approvalPolicyLabels,
    roomModeLabels,
    devicePublicKeyFingerprint,
    inviteAdmissionsByRoom,
    markIncomingChatUnread,
    rememberForgottenRoom,
    restoreForgottenRoom,
    refreshTeamMembers,
    revokedRoomIds,
    revokedTeamIds,
    selectedRoom.approvalPolicy,
    selectedRoom.approvalDelegationPolicy,
    selectedRoom.browserAllowedOrigins,
    selectedRoom.id,
    selectedRoom.name,
    selectedRoom.teamId,
    selectedTeam,
    replaceRelayStatus
  ]);
}

function handleCodexQueueEvent(
  event: CodexQueuePlaintextPayload,
  roomId: string,
  enqueueCodexApprovalForRoom: (roomId: string, turn: QueuedCodexTurn) => void,
  removeQueuedCodexApprovalForRoom: (roomId: string, turnId: string) => void,
  setPendingCodexApprovalForRoom: (roomId: string, approval: null) => void,
  setApprovalVisibleForRoom: (roomId: string, visible: boolean) => void,
  setHostMessageForRoom: (roomId: string, message: string | null) => void
) {
  if (event.action === "queued" || event.action === "promoted") {
    enqueueCodexApprovalForRoom(roomId, {
      roomId,
      turnId: event.turnId,
      requestedBy: event.requestedBy,
      requestedByUserId: event.requestedByUserId,
      queuedAt: event.createdAt,
      ...(event.triggerMessageId ? { triggerMessageId: event.triggerMessageId } : {})
    });
    setHostMessageForRoom(roomId, `${event.requestedBy} proposed a Codex turn for host approval.`);
    return;
  }
  removeQueuedCodexApprovalForRoom(roomId, event.turnId);
  setPendingCodexApprovalForRoom(roomId, null);
  setApprovalVisibleForRoom(roomId, false);
  setHostMessageForRoom(roomId, event.reason ?? `${event.requestedBy}'s Codex turn was ${event.action}.`);
}
