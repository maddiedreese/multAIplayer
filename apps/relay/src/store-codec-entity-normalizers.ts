import {
  DeviceRecord as DeviceRecordSchema,
  RoomRecord as RoomRecordSchema,
  TeamMemberRecord as TeamMemberRecordSchema,
  TeamRecord as TeamRecordSchema,
  defaultApprovalDelegationPolicy,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultRoomMode,
  isRecord,
  type DeviceRecord,
  type RoomRecord,
  type TeamMemberRecord,
  type TeamRecord
} from "@multaiplayer/protocol";
import { z } from "zod";
import { fingerprintPublicKey, validP256HpkeKey, validP256Spki } from "./http/devices.js";
import {
  isApprovalDelegationPolicy,
  isApprovalPolicy,
  isRoomMode,
  normalizeBrowserAllowedOrigins,
  normalizeMetadataText,
  normalizeOptionalMetadataText,
  normalizeRelayId,
  normalizeTeamRole
} from "./limits.js";
import type { RelayStoreCodecOptions } from "./store-codec.js";
import { parseStoredRecord, StoredTeamMembers } from "./store-codec-schemas.js";

export function createStoredEntityNormalizers(options: RelayStoreCodecOptions) {
  const { store } = options;
  const now = options.now ?? Date.now;

  function normalizeTeam(team: unknown): TeamRecord | null {
    if (!isRecord(team)) return null;
    const id = normalizeRelayId(team.id, options.maxTeamIdChars);
    const name = normalizeMetadataText(team.name, options.maxTeamNameChars);
    if (!id || !name) return null;
    const members = validCounter(team.members) ? team.members : 0;
    const candidate = {
      id,
      name,
      members,
      archivedAt: validDate(team.archivedAt),
      deletedAt: validDate(team.deletedAt)
    };
    const parsed = TeamRecordSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  function normalizeDevice(device: unknown): DeviceRecord | null {
    const parsed = DeviceRecordSchema.safeParse(device);
    if (!parsed.success) return null;
    const normalized = parsed.data;
    if (
      !validP256Spki(normalized.signaturePublicKey, options.maxPublicKeyJwkChars) ||
      !validP256HpkeKey(normalized.hpkePublicKey, options.maxPublicKeyJwkChars) ||
      normalized.signatureKeyFingerprint !== fingerprintPublicKey(normalized.signaturePublicKey) ||
      normalized.hpkeKeyFingerprint !== fingerprintPublicKey(normalized.hpkePublicKey)
    ) {
      return null;
    }
    return normalized;
  }

  function normalizeRoom(room: unknown): RoomRecord | null {
    if (!isRecord(room)) return null;
    const id = normalizeRelayId(room.id, options.maxRoomIdChars);
    const teamId = normalizeRelayId(room.teamId, options.maxTeamIdChars);
    if (!id || !teamId || !store.teams.has(teamId)) return null;
    const hostStatus = normalizeHostStatus(room.hostStatus);
    const hostUserId = normalizeOptionalMetadataText(room.hostUserId, options.maxUserIdChars) || undefined;
    const candidate = {
      id,
      teamId,
      acceptedMlsEpoch: normalizeAcceptedEpoch(room.acceptedMlsEpoch, hostStatus),
      name: normalizeMetadataText(room.name, options.maxRoomNameChars) ?? "Untitled room",
      host: hostUserId ? (normalizeMetadataText(room.host, options.maxHostNameChars) ?? "Reserved host") : "No host",
      hostUserId,
      activeHostDeviceId:
        hostStatus === "offline"
          ? undefined
          : normalizeOptionalMetadataText(room.activeHostDeviceId, options.maxDeviceIdChars) || undefined,
      hostStatus,
      approvalPolicy:
        typeof room.approvalPolicy === "string" && isApprovalPolicy(room.approvalPolicy)
          ? room.approvalPolicy
          : "ask_every_turn",
      approvalDelegationPolicy:
        typeof room.approvalDelegationPolicy === "string" && isApprovalDelegationPolicy(room.approvalDelegationPolicy)
          ? room.approvalDelegationPolicy
          : defaultApprovalDelegationPolicy,
      trustedApproverUserIds: normalizeTrustedApprovers(room.trustedApproverUserIds, options.maxUserIdChars),
      mode: isRoomMode(room.mode) ? room.mode : defaultRoomMode,
      browserAllowedOrigins: normalizeBrowserAllowedOrigins(room.browserAllowedOrigins) ?? defaultBrowserAllowedOrigins,
      browserProfilePersistent:
        typeof room.browserProfilePersistent === "boolean"
          ? room.browserProfilePersistent
          : defaultBrowserProfilePersistent,
      unread: validCounter(room.unread) ? room.unread : 0,
      archivedAt: validDate(room.archivedAt),
      deletedAt: validDate(room.deletedAt)
    };
    const parsed = RoomRecordSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  function applyStoredTeamMembers(item: unknown): void {
    const parsed = parseStoredRecord(StoredTeamMembers, item);
    if (!parsed) return;
    const teamId = normalizeRelayId(parsed.teamId, options.maxTeamIdChars);
    if (!teamId || !store.teams.has(teamId)) return;
    const members = new Map<string, TeamMemberRecord>();
    for (const member of parsed.members ?? []) addStoredMember(members, teamId, member, options.maxUserIdChars, now());
    for (const userId of parsed.userIds ?? []) addLegacyMember(members, teamId, userId, options.maxUserIdChars, now());
    if (members.size === 0) return;
    store.teamMembers.set(teamId, members);
    const team = store.teams.get(teamId);
    if (team && team.members < members.size) store.teams.set(teamId, { ...team, members: members.size });
  }

  return { normalizeTeam, normalizeDevice, normalizeRoom, applyStoredTeamMembers };
}

function addStoredMember(
  members: Map<string, TeamMemberRecord>,
  teamId: string,
  value: unknown,
  maxUserIdChars: number,
  now: number
): void {
  if (!isRecord(value)) return;
  const userId = normalizeMetadataText(value.userId, maxUserIdChars);
  if (!userId) return;
  const parsed = TeamMemberRecordSchema.safeParse({
    teamId,
    userId,
    role: normalizeTeamRole(value.role),
    joinedAt: validDate(value.joinedAt) ?? new Date(now).toISOString()
  });
  if (parsed.success) members.set(userId, parsed.data);
}

function addLegacyMember(
  members: Map<string, TeamMemberRecord>,
  teamId: string,
  value: unknown,
  maxUserIdChars: number,
  now: number
): void {
  const userId = normalizeMetadataText(value, maxUserIdChars);
  if (!userId || members.has(userId)) return;
  members.set(userId, { teamId, userId, role: "member", joinedAt: new Date(now).toISOString() });
}

function normalizeTrustedApprovers(value: unknown, maxUserIdChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeMetadataText(item, maxUserIdChars))
    .filter((item): item is string => Boolean(item))
    .slice(0, 50);
}

function normalizeHostStatus(value: unknown): RoomRecord["hostStatus"] {
  return value === "active" || value === "handoff" || value === "offline" ? value : "offline";
}

function normalizeAcceptedEpoch(value: unknown, hostStatus: RoomRecord["hostStatus"]): number | undefined {
  return validCounter(value) ? value : hostStatus === "active" ? 0 : undefined;
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validDate(value: unknown): string | undefined {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
