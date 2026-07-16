import type { Express, Response } from "express";
import type { RoomRecord } from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";

export interface RegisterRoomRoutesOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  teamIdsForUser: (userId: string) => Set<string>;
  isTeamMember: (teamId: string, userId: string) => boolean;
  canAccessRoom: (teamId: string, roomId: string, userId: string) => boolean;
  scheduleStoreSave: () => void;
  saveRelayStore: () => Promise<void>;
  broadcastRoomUpdated: (room: RoomRecord) => void;
  recordQuotaRejection?: (type: string) => void;
  recordCapacityRejection?: (resource: string, scope: string) => void;
  requesterFromRequest: (body: unknown, sessionId: unknown) => { id: string; name: string };
  isRoomHost: (room: RoomRecord, requester: { id: string; name: string }) => boolean;
  isApprovalPolicy: (value: string) => value is RoomRecord["approvalPolicy"];
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeOptionalMetadataText: (value: unknown, maxChars: number) => string | null;
  displayNameForUser: (user: AuthSession["user"]) => string;
  maxDeviceIdChars: number;
  maxHostNameChars: number;
  maxRoomNameChars: number;
  maxUserIdChars: number;
  deviceAuthRequired: boolean;
  dailyCreationCaps?: { roomsPerUser: number };
  totalRoomCapPerUser?: number;
}
