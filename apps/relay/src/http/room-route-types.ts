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

export type RoomCreateRouteOptions = Pick<
  RegisterRoomRoutesOptions,
  | "app"
  | "store"
  | "getAuthSession"
  | "allowMutation"
  | "teamIdsForUser"
  | "isTeamMember"
  | "scheduleStoreSave"
  | "saveRelayStore"
  | "broadcastRoomUpdated"
  | "recordQuotaRejection"
  | "recordCapacityRejection"
  | "isApprovalPolicy"
  | "normalizeMetadataText"
  | "displayNameForUser"
  | "maxHostNameChars"
  | "maxRoomNameChars"
  | "dailyCreationCaps"
  | "totalRoomCapPerUser"
>;

export type RoomHostRouteOptions = Pick<
  RegisterRoomRoutesOptions,
  | "app"
  | "store"
  | "getAuthSession"
  | "allowMutation"
  | "canAccessRoom"
  | "scheduleStoreSave"
  | "broadcastRoomUpdated"
  | "normalizeMetadataText"
  | "maxDeviceIdChars"
  | "maxHostNameChars"
  | "maxUserIdChars"
>;

export type RoomSettingsRouteOptions = Pick<
  RegisterRoomRoutesOptions,
  | "app"
  | "store"
  | "getAuthSession"
  | "allowMutation"
  | "canAccessRoom"
  | "scheduleStoreSave"
  | "broadcastRoomUpdated"
  | "requesterFromRequest"
  | "isRoomHost"
  | "isApprovalPolicy"
  | "normalizeMetadataText"
  | "maxRoomNameChars"
>;

export type RoomLifecycleRouteOptions = Pick<
  RegisterRoomRoutesOptions,
  | "app"
  | "store"
  | "getAuthSession"
  | "allowMutation"
  | "isTeamMember"
  | "scheduleStoreSave"
  | "broadcastRoomUpdated"
  | "requesterFromRequest"
  | "isRoomHost"
>;
