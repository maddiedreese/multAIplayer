import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  BrowserRequestPlaintextPayload,
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
import type { GitHubActionRun } from "../lib/authClient";
import { connectRelay, type RelayClient } from "../lib/relayClient";
import { buildRoomSettingsSystemMessage } from "../lib/roomSettingsMessages";
import { loadRoomSecret, replaceRoomSecret } from "../lib/localHistory";
import { ensureRoomDefaults } from "../lib/roomDefaults";
import { markRoomUnreadForIncomingChat } from "../lib/roomUnread";
import { withoutSetValue } from "../lib/setUtils";
import { normalizeChatMessage } from "../lib/chatSanitizer";
import {
  buildCodexEventLine,
  buildGitHubActionsEventLines,
  buildGitWorkflowEventLines,
  buildTerminalResultLines
} from "../lib/activityLines";
import {
  isChatReactionPlaintextPayload,
  isCodexEventPlaintextPayload,
  isGitHubActionsEventPlaintextPayload,
  isGitWorkflowEventPlaintextPayload,
  isLegacyDebugChatMessage,
  isLocalPreviewPlaintextPayload,
  isRequestStatusPlaintextPayload,
  isRoomKeyRotationPlaintextPayload,
  isRoomSettingsPlaintextPayload,
  isTerminalResultPlaintextPayload
} from "../lib/localRoomHistoryPayload";
import { formatMessageTime } from "../lib/appFormatters";
import type {
  BrowserAccessRequest,
  ChatMessage,
  CodexRoomEvent,
  HostHandoffRecord,
  LocalPreviewRecord,
  RelayStatus,
  RoomPresence,
  TerminalCommandRequest
} from "../types";

type StatusSetter = Dispatch<SetStateAction<RelayStatus>>;
type PresenceByRoom = Record<string, Record<string, RoomPresence>>;

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
  revokedRoomIds: Set<string>;
  revokedTeamIds: Set<string>;
  approvalPolicyLabels: Record<string, string>;
  roomModeLabels: Record<string, string>;
  relayRef: MutableRefObject<RelayClient | null>;
  seenEnvelopeIds: MutableRefObject<Set<string>>;
  roomsRef: MutableRefObject<RoomRecord[]>;
  selectedRoomIdRef: MutableRefObject<string>;
  historyLoadedRoomIds: MutableRefObject<Set<string>>;
  setRelayStatus: StatusSetter;
  setPresenceByRoom: Dispatch<SetStateAction<PresenceByRoom>>;
  setRooms: Dispatch<SetStateAction<RoomRecord[]>>;
  setActionRunsByRoom: Dispatch<SetStateAction<Record<string, GitHubActionRun[]>>>;
  setActionsLastCheckedByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setActionsMessagesByRoom: Dispatch<SetStateAction<Record<string, string | null>>>;
  setForgottenRoomIds: Dispatch<SetStateAction<Set<string>>>;
  handleRelayError: (message: string) => void;
  upsertRoom: (room: RoomRecord) => void;
  upsertTeam: (team: TeamRecord) => void;
  refreshTeamMembers: (teamId: string, quiet?: boolean) => Promise<void>;
  decryptInviteEnvelope: (envelope: RelayEnvelope) => Promise<unknown | null>;
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
  applyMessageReaction: (roomId: string, reaction: ChatReactionPlaintextPayload) => void;
  appendTerminalRequest: (roomId: string, request: TerminalCommandRequest) => void;
  updateTerminalRequestStatus: (roomId: string, requestId: string, status: TerminalCommandRequest["status"]) => void;
  appendTerminalLinesForRoom: (roomId: string, lines: string[]) => void;
  appendGitWorkflowEvent: (roomId: string, event: GitWorkflowEventPlaintextPayload) => void;
  setGitWorkflowMessageForRoom: (roomId: string, message: string | null) => void;
  appendGitHubActionsEvent: (roomId: string, event: GitHubActionsEventPlaintextPayload) => void;
  appendCodexEvent: (roomId: string, event: CodexRoomEvent) => void;
  appendBrowserRequest: (roomId: string, request: BrowserAccessRequest) => void;
  updateBrowserRequestStatus: (roomId: string, requestId: string, status: BrowserAccessRequest["status"]) => void;
  appendLocalPreviewEvent: (roomId: string, event: LocalPreviewRecord) => void;
  setChatMessageForRoom: (roomId: string, message: string | null) => void;
  markHostHandoffAccepted: (roomId: string, handoffId: string) => void;
  setHostMessageForRoom: (roomId: string, message: string | null) => void;
  appendHostHandoff: (roomId: string, handoff: HostHandoffRecord) => void;
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
  revokedRoomIds,
  revokedTeamIds,
  approvalPolicyLabels,
  roomModeLabels,
  relayRef,
  seenEnvelopeIds,
  roomsRef,
  selectedRoomIdRef,
  historyLoadedRoomIds,
  setRelayStatus,
  setPresenceByRoom,
  setRooms,
  setActionRunsByRoom,
  setActionsLastCheckedByRoom,
  setActionsMessagesByRoom,
  setForgottenRoomIds,
  handleRelayError,
  upsertRoom,
  upsertTeam,
  refreshTeamMembers,
  decryptInviteEnvelope,
  handleInviteEnvelopePlaintext,
  handleCodexBrowserOpenCommand,
  applyMessageReaction,
  appendTerminalRequest,
  updateTerminalRequestStatus,
  appendTerminalLinesForRoom,
  appendGitWorkflowEvent,
  setGitWorkflowMessageForRoom,
  appendGitHubActionsEvent,
  appendCodexEvent,
  appendBrowserRequest,
  updateBrowserRequestStatus,
  appendLocalPreviewEvent,
  setChatMessageForRoom,
  markHostHandoffAccepted,
  setHostMessageForRoom,
  appendHostHandoff,
  appendRoomMessage,
  setInviteMessageForRoom
}: UseRelaySubscriptionOptions) {
  useEffect(() => {
    void isActiveHost;
    let cancelled = false;
    setPresenceByRoom({});
    const client = connectRelay(
      relayWsUrl,
      async (message) => {
        if (cancelled) return;
        if (message.type === "joined") {
          setRelayStatus("open");
          return;
        }
        if (message.type === "team.subscribed") {
          return;
        }
        if (message.type === "workspace.subscribed") {
          setRelayStatus("open");
          return;
        }
        if (message.type === "error") {
          handleRelayError(message.message);
          return;
        }
        if (message.type === "presence") {
          setPresenceByRoom((current) => {
            const roomPresence = current[message.roomId] ?? {};
            const nextRoomPresence = { ...roomPresence };
            if (message.status === "offline") {
              delete nextRoomPresence[message.deviceId];
            } else {
              nextRoomPresence[message.deviceId] = {
                userId: message.userId,
                deviceId: message.deviceId,
                displayName: message.displayName,
                avatarUrl: message.avatarUrl,
                publicKeyFingerprint: message.publicKeyFingerprint,
                status: message.status
              };
            }
            return {
              ...current,
              [message.roomId]: nextRoomPresence
            };
          });
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
            setForgottenRoomIds((current) => new Set(current).add(message.envelope.roomId));
            return;
          }
          if (message.envelope.kind === "chat.message") {
            const plaintext = await decryptJson<ChatPlaintextPayload>(roomPayload, secret);
            const chatMessage = normalizeChatMessage(plaintext) as ChatMessage | null;
            if (!chatMessage) return;
            if (isLegacyDebugChatMessage(chatMessage)) return;
            setRooms((current) =>
              markRoomUnreadForIncomingChat(
                current,
                message.envelope.roomId,
                selectedRoomIdRef.current,
                message.envelope.senderDeviceId,
                deviceId
              )
            );
            appendRoomMessage(message.envelope.roomId, chatMessage);
            const envelopeRoom = roomsRef.current.find((room) => room.id === message.envelope.roomId);
            if (envelopeRoom) handleCodexBrowserOpenCommand(chatMessage, envelopeRoom);
          }
          if (message.envelope.kind === "chat.reaction") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isChatReactionPlaintextPayload(plaintext)) {
              applyMessageReaction(message.envelope.roomId, plaintext);
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
              appendGitHubActionsEvent(message.envelope.roomId, plaintext);
              setActionRunsByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: plaintext.runs
              }));
              setActionsLastCheckedByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: plaintext.checkedAt
              }));
              setActionsMessagesByRoom((current) => ({
                ...current,
                [message.envelope.roomId]: `${plaintext.summary.label}: ${plaintext.message}`
              }));
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
          if (message.envelope.kind === "browser.request") {
            const plaintext = await decryptJson<BrowserRequestPlaintextPayload>(roomPayload, secret);
            appendBrowserRequest(message.envelope.roomId, { ...plaintext, status: "pending" });
          }
          if (message.envelope.kind === "browser.event") {
            const plaintext = await decryptJson<RequestStatusPlaintextPayload>(roomPayload, secret);
            updateBrowserRequestStatus(message.envelope.roomId, plaintext.requestId, plaintext.status);
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
              markHostHandoffAccepted(message.envelope.roomId, plaintext.id);
              setHostMessageForRoom(
                message.envelope.roomId,
                `${plaintext.acceptedBy ?? "A room member"} accepted host handoff from ${plaintext.fromHost}.`
              );
            } else {
              appendHostHandoff(message.envelope.roomId, { ...plaintext, status: "available" });
            }
          }
          if (message.envelope.kind === "room.settings") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomSettingsPlaintextPayload(plaintext)) {
              appendRoomMessage(
                message.envelope.roomId,
                buildRoomSettingsSystemMessage(plaintext, { approvalPolicyLabels, roomModeLabels })
              );
            }
          }
          if (message.envelope.kind === "room.key") {
            const plaintext = await decryptJson<unknown>(roomPayload, secret);
            if (isRoomKeyRotationPlaintextPayload(plaintext)) {
              await replaceRoomSecret(message.envelope.roomId, plaintext.newSecret);
              historyLoadedRoomIds.current.add(message.envelope.roomId);
              setForgottenRoomIds((current) => withoutSetValue(current, message.envelope.roomId));
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
      setRelayStatus,
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
    devicePublicKeyFingerprint,
    inviteAdmissionsByRoom,
    refreshTeamMembers,
    revokedRoomIds,
    revokedTeamIds,
    selectedRoom.approvalPolicy,
    selectedRoom.browserAllowedOrigins,
    selectedRoom.id,
    selectedRoom.name,
    selectedRoom.teamId,
    selectedTeam
  ]);
}
