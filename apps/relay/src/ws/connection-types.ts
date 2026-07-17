import type { IncomingMessage } from "node:http";
import type { WebSocketServer } from "ws";
import type { MlsRelayMessage, RelayServerMessage } from "@multaiplayer/protocol";
import type { RelayLimits } from "../limits.js";
import type { AuthSession, ClientSession, PresenceRecord, RelayStore, RoomKey } from "../state.js";

export type WebSocketRateLimitBucket = "websocket" | "websocketConnect";

export interface RelayWebSocketConnectionOptions {
  transport: {
    wss: WebSocketServer;
    send: (socket: ClientSession["socket"], message: RelayServerMessage) => void;
    sendConnectionError: (
      socket: ClientSession["socket"],
      message: Extract<RelayServerMessage, { type: "error" }>
    ) => void;
    isReady?: () => boolean;
  };
  state: {
    store: Pick<
      RelayStore,
      "getDevice" | "getInvite" | "getMlsBacklog" | "getRoom" | "getTeamMember" | "inviteRequests" | "inviteResponses"
    >;
    sessions: Map<ClientSession["socket"], ClientSession>;
    roomPresence: Map<RoomKey, Map<string, PresenceRecord>>;
  };
  limits: RelayLimits;
  authentication: {
    getAuthSessionFromRequest: (request: IncomingMessage) => AuthSession | undefined;
    isLiveClientSession: (session: ClientSession) => boolean;
    clientIdentityFromIncomingMessage: (request: IncomingMessage) => string;
    clientRateLimitIdentitiesFromIncomingMessage?: (request: IncomingMessage) => string[];
  };
  rateLimiting: {
    consume: (bucket: WebSocketRateLimitBucket, clientId: string) => { allowed: boolean };
    connectionCaps: { perUser: number; perDevice: number };
  };
  metrics: {
    recordQuotaRejection?: (type: string) => void;
    recordCapacityRejection?: (resource: string, scope: string) => void;
    recordRateLimitRejection?: (bucket: string) => void;
    recordRateLimitAllowed?: (bucket: string) => void;
    recordConnectionAttempt?: () => void;
    recordConnectionAccepted?: () => void;
    recordConnectionRejection?: (reason: string) => void;
  };
  rooms: {
    roomKey: (teamId: string, roomId: string) => RoomKey;
    isKnownRoom: (teamId: string, roomId: string) => boolean;
    canAuthenticateJoinIdentity: (session: ClientSession, userId: string) => boolean;
    canJoinRoom: (
      session: ClientSession,
      teamId: string,
      roomId: string,
      userId: string,
      deviceId: string,
      inviteId?: string
    ) => boolean;
    hasDeviceSession: (token: string, userId: string, deviceId: string) => boolean;
    joinRoom: (session: ClientSession, teamId: string, roomId: string, userId: string, deviceId: string) => void;
    canSubscribeTeam: (session: ClientSession, teamId: string, userId: string) => boolean;
    subscribeTeam: (session: ClientSession, teamId: string) => void;
    hasTeam: (teamId: string) => boolean;
    canSubscribeWorkspace: (session: ClientSession, userId: string) => boolean;
    subscribeWorkspace: (session: ClientSession) => void;
    canPublishMlsMessage: (session: ClientSession, message: MlsRelayMessage) => boolean;
    canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
    publishMlsMessage: (message: MlsRelayMessage, remainsAuthorized: () => boolean) => Promise<void>;
    publishPresence: (session: ClientSession, teamId: string, roomId: string, presence: PresenceRecord) => void;
    leaveRoom: (session: ClientSession) => void;
    leaveTeams: (session: ClientSession) => void;
    leaveWorkspace: (session: ClientSession) => void;
  };
  validation: {
    normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
    isJsonStringifiableWithin: (value: unknown, maxChars: number) => boolean;
    isRecord: (value: unknown) => value is Record<string, unknown>;
  };
}
