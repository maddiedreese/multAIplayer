import type { Express, Response } from "express";
import type { AuthSession, RelayStore } from "../state.js";
import { acquireAccountMutationTurn, isLiveAccountSession } from "../auth/account-mutation-transaction.js";
import { sendRelayError } from "./errors.js";

export interface DeviceRetirementRouteOptions {
  app: Express;
  store: RelayStore;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  allowMutation: (session: AuthSession | null, res: Response) => boolean;
  saveRelayStore: () => Promise<void>;
  revokeDeviceSessions: (userId: string, deviceId: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxDeviceIdChars: number;
}

export function registerDeviceRetirementRoute(options: DeviceRetirementRouteOptions): void {
  const { app, store, getAuthSession, allowMutation } = options;
  app.delete("/devices/:deviceId", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session)
      return void sendRelayError(res, 401, "authentication_required", "Sign in before retiring a device identity.");

    const deviceId = options.normalizeMetadataText(req.params.deviceId, options.maxDeviceIdChars);
    if (!deviceId || req.body?.confirmation !== deviceId) {
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Repeat the exact device id in confirmation to retire it."
      );
    }
    const releaseAccountMutation = await acquireAccountMutationTurn(store, session.user.id);
    try {
      if (!isLiveAccountSession(store, session)) {
        return void sendRelayError(res, 401, "authentication_required", "Sign in again before retiring a device.");
      }
      if (!store.getDevice(session.user.id, deviceId)) {
        return void sendRelayError(res, 404, "not_found", "Device not found.");
      }
      if (hostsRetainedRoom(store, session.user.id, deviceId)) {
        return void sendRelayError(
          res,
          409,
          "conflict",
          "Transfer or delete every room hosted by this device before retiring it."
        );
      }

      const retired = retireDeviceState(store, session.user.id, deviceId);
      try {
        await options.saveRelayStore();
      } catch {
        restoreRetiredDeviceState(store, retired);
        return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist device retirement.");
      }
      options.revokeDeviceSessions(session.user.id, deviceId);
      res.json({ retiredDeviceId: deviceId });
    } finally {
      releaseAccountMutation();
    }
  });
}

function hostsRetainedRoom(store: RelayStore, userId: string, deviceId: string): boolean {
  return Array.from(store.rooms.values()).some(
    (room) => !room.deletedAt && room.hostUserId === userId && room.activeHostDeviceId === deviceId
  );
}

type Entries<MapType> = MapType extends Map<string, infer Value> ? Array<[string, Value]> : never;

interface RetiredDeviceState {
  device: [string, RelayStore["devices"] extends Map<string, infer Value> ? Value : never];
  deviceSessions: Entries<RelayStore["deviceSessions"]>;
  deviceChallenges: Entries<RelayStore["deviceChallenges"]>;
  keyPackages: Entries<RelayStore["keyPackages"]>;
  invites: Entries<RelayStore["invites"]>;
  inviteRequests: Entries<RelayStore["inviteRequests"]>;
  inviteResponses: Entries<RelayStore["inviteResponses"]>;
  inviteAckReceipts: Entries<RelayStore["inviteAckReceipts"]>;
}

function retireDeviceState(store: RelayStore, userId: string, deviceId: string): RetiredDeviceState {
  const deviceKey = `${userId}:${deviceId}`;
  const revokedApprovedInviteIds = new Set(
    Array.from(store.invites.values())
      .filter((invite) => invite.approvedUserId === userId && invite.approvedDeviceId === deviceId)
      .map((invite) => invite.id)
  );
  const retired: RetiredDeviceState = {
    device: [deviceKey, store.devices.get(deviceKey)!],
    deviceSessions: matchingEntries(
      store.deviceSessions,
      (item) => item.userId === userId && item.deviceId === deviceId
    ),
    deviceChallenges: matchingEntries(
      store.deviceChallenges,
      (item) => item.userId === userId && item.deviceId === deviceId
    ),
    keyPackages: matchingEntries(store.keyPackages, (item) => item.userId === userId && item.deviceId === deviceId),
    invites: matchingEntries(store.invites, (item) => revokedApprovedInviteIds.has(item.id)),
    inviteRequests: matchingEntries(
      store.inviteRequests,
      (item) =>
        revokedApprovedInviteIds.has(item.inviteId) ||
        (item.requesterUserId === userId && item.requesterDeviceId === deviceId)
    ),
    inviteResponses: matchingEntries(
      store.inviteResponses,
      (item) =>
        revokedApprovedInviteIds.has(item.inviteId) ||
        (item.requesterUserId === userId && item.requesterDeviceId === deviceId) ||
        (item.responseBinding.hostUserId === userId && item.responseBinding.hostDeviceId === deviceId)
    ),
    inviteAckReceipts: matchingEntries(
      store.inviteAckReceipts,
      (item) =>
        revokedApprovedInviteIds.has(item.inviteId) ||
        (item.requesterUserId === userId && item.requesterDeviceId === deviceId)
    )
  };
  store.devices.delete(deviceKey);
  deleteEntries(store.deviceSessions, retired.deviceSessions);
  deleteEntries(store.deviceChallenges, retired.deviceChallenges);
  deleteEntries(store.keyPackages, retired.keyPackages);
  deleteEntries(store.invites, retired.invites);
  deleteEntries(store.inviteRequests, retired.inviteRequests);
  deleteEntries(store.inviteResponses, retired.inviteResponses);
  deleteEntries(store.inviteAckReceipts, retired.inviteAckReceipts);
  return retired;
}

function restoreRetiredDeviceState(store: RelayStore, retired: RetiredDeviceState): void {
  store.devices.set(...retired.device);
  restoreEntries(store.deviceSessions, retired.deviceSessions);
  restoreEntries(store.deviceChallenges, retired.deviceChallenges);
  restoreEntries(store.keyPackages, retired.keyPackages);
  restoreEntries(store.invites, retired.invites);
  restoreEntries(store.inviteRequests, retired.inviteRequests);
  restoreEntries(store.inviteResponses, retired.inviteResponses);
  restoreEntries(store.inviteAckReceipts, retired.inviteAckReceipts);
}

function matchingEntries<Value>(
  source: Map<string, Value>,
  predicate: (value: Value) => boolean
): Array<[string, Value]> {
  return Array.from(source).filter((entry) => predicate(entry[1]));
}

function deleteEntries<Value>(target: Map<string, Value>, entries: Array<[string, Value]>): void {
  for (const [key] of entries) target.delete(key);
}

function restoreEntries<Value>(target: Map<string, Value>, entries: Array<[string, Value]>): void {
  for (const [key, value] of entries) target.set(key, value);
}
