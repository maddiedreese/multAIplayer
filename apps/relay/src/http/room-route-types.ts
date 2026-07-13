import type { Express, Response } from "express";
import type { ApprovalDelegationPolicy, RoomRecord } from "@multaiplayer/protocol";
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
  broadcastRoomUpdated: (room: RoomRecord) => void;
  recordQuotaRejection?: (type: string) => void;
  requesterFromRequest: (body: unknown, sessionId: unknown) => { id: string; name: string };
  isRoomHost: (room: RoomRecord, requester: { id: string; name: string }) => boolean;
  isApprovalPolicy: (value: string) => value is RoomRecord["approvalPolicy"];
  isApprovalDelegationPolicy: (value: string) => value is ApprovalDelegationPolicy;
  isRoomMode: (value: unknown) => value is RoomRecord["mode"];
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeOptionalMetadataText: (value: unknown, maxChars: number) => string | null;
  normalizeRoomProjectPath: (value: unknown) => string | null;
  normalizeCodexModel: (value: unknown) => string | null;
  normalizeCodexReasoningEffort: (value: unknown) => RoomRecord["codexReasoningEffort"] | null;
  normalizeCodexSpeed: (value: unknown) => RoomRecord["codexSpeed"] | null;
  normalizeBrowserAllowedOrigins: (value: unknown) => string[] | null;
  displayNameForUser: (user: AuthSession["user"]) => string;
  maxCodexModelChars: number;
  maxDeviceIdChars: number;
  maxHostNameChars: number;
  maxRoomNameChars: number;
  maxRoomProjectPathChars: number;
  maxUserIdChars: number;
  deviceAuthRequired: boolean;
}
