import { useEffect, type MutableRefObject } from "react";
import type { RelayEnvelope, RoomRecord, TeamRecord } from "@multaiplayer/protocol";
import { connectRelay, type RelayClient } from "../../lib/relayClient";
import { trustedAvatarUrl } from "../../lib/avatarUrl";
import { ensureRoomDefaults } from "../../lib/roomDefaults";
import { useAppStore } from "../../store/appStore";
import type { ChatMessage } from "../../types";
import { useLatestRef } from "../useLatestRef";
import { routeRelayEnvelope } from "./routeRelayEnvelope";

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
  decryptInviteEnvelope: (envelope: RelayEnvelope) => Promise<unknown | null>;
  handleInviteEnvelopePlaintext: (roomId: string, plaintext: unknown) => Promise<void>;
  handleCodexBrowserOpenCommand: (message: ChatMessage, room: RoomRecord) => boolean;
}

export function useRelaySubscription(options: UseRelaySubscriptionOptions) {
  const {
    relayWsUrl,
    deviceId,
    localUser,
    devicePublicKeyFingerprint,
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
    useAppStore.getState().clearPresenceByRoom();
    const client = connectRelay(
      relayWsUrl,
      async (message) => {
        if (cancelled) return;
        const current = latest.current;
        const store = useAppStore.getState();
        if (message.type === "joined" || message.type === "workspace.subscribed") {
          store.replaceRelayStatus("open");
          return;
        }
        if (message.type === "team.subscribed") return;
        if (message.type === "error") {
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
        if (message.type !== "envelope" || seenEnvelopeIds.current.has(message.envelope.id)) return;
        seenEnvelopeIds.current.add(message.envelope.id);
        try {
          await routeRelayEnvelope(message.envelope, {
            deviceId: current.deviceId,
            localUser: current.localUser,
            roomsRef: current.roomsRef,
            selectedRoomIdRef: current.selectedRoomIdRef,
            historyLoadedRoomIds: current.historyLoadedRoomIds,
            markIncomingChatUnread: current.markIncomingChatUnread,
            decryptInviteEnvelope: current.decryptInviteEnvelope,
            handleInviteEnvelopePlaintext: current.handleInviteEnvelopePlaintext,
            handleCodexBrowserOpenCommand: current.handleCodexBrowserOpenCommand
          });
        } catch {
          console.warn("Failed to decrypt relay envelope");
        }
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
        openClient.publish({
          type: "join",
          teamId: selectedRoom.teamId,
          roomId: selectedRoom.id,
          userId: localUser.id,
          deviceId,
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
