import type {
  ApprovalPolicy,
  AttachmentBlobRecord,
  DeviceRecord,
  InviteRecord,
  InviteResponseRecord,
  KeyPackageRecord,
  KeyPackageUpload,
  ClientRoomRecord,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamRole
} from "@multaiplayer/protocol";
import { getRelayHttpUrl } from "../../lib/core/appConfig";
import { readJsonResponse } from "../../lib/core/httpResponse";
import { deviceSessionHeaders } from "../../lib/identity/deviceSession";
import { ensureRoomDefaults } from "../../lib/room/roomDefaults";
import { useAppStore } from "../../store/appStore";

export interface WorkspaceSnapshot {
  teams: TeamRecord[];
  rooms: ClientRoomRecord[];
}

export interface RoomCreationSettings {
  approvalPolicy?: ApprovalPolicy;
  codexModel?: string;
  codexModelPolicy?: ClientRoomRecord["codexModelPolicy"];
  codexReasoningEffort?: ClientRoomRecord["codexReasoningEffort"];
  codexReasoningEffortPolicy?: ClientRoomRecord["codexReasoningEffortPolicy"];
  codexRawReasoningEnabled?: boolean;
  codexSpeed?: ClientRoomRecord["codexSpeed"];
  codexServiceTierPolicy?: ClientRoomRecord["codexServiceTierPolicy"];
  codexSandboxLevel?: ClientRoomRecord["codexSandboxLevel"];
}

export interface InviteLookupResult {
  invite: InviteRecord;
  team: TeamRecord;
  room: ClientRoomRecord;
  hostDevice: Pick<
    DeviceRecord,
    "userId" | "deviceId" | "signaturePublicKey" | "signatureKeyFingerprint" | "hpkePublicKey" | "hpkeKeyFingerprint"
  > | null;
}

export interface DeviceRegistrationRequest {
  userId: string;
  deviceId: string;
  displayName: string;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
  hpkePublicKey: string;
  hpkeKeyFingerprint: string;
}

export interface AttachmentBlobUploadRequest {
  blobId: string;
  teamId: string;
  roomId: string;
  name: string;
  type: string;
  size: number;
  epoch: number;
  sealedBlob: string;
}

export interface DirectedInviteRequest {
  requestId: string;
  requesterUserId: string;
  requesterDeviceId: string;
  keyPackageId: string;
  keyPackageHash: string;
  sealedRequest: string;
  createdAt: string;
  requesterDevice: Pick<DeviceRecord, "userId" | "deviceId" | "signaturePublicKey" | "signatureKeyFingerprint"> | null;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch(`${getRelayHttpUrl()}/teams`, { credentials: "include" });
  const snapshot = await readJsonResponse<{ teams: TeamRecord[]; rooms: RoomRecord[] }>(
    response,
    "Failed to load workspace"
  );
  const currentRooms = useAppStore.getState().rooms;
  return {
    teams: snapshot.teams,
    rooms: snapshot.rooms.map((room) =>
      ensureRoomDefaults(
        room,
        currentRooms.find((current) => current.id === room.id)
      )
    )
  };
}

export async function createTeam(name: string): Promise<TeamRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/teams`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  const body = await readJsonResponse<{ team: TeamRecord }>(response, "Failed to create team");
  return body.team as TeamRecord;
}

export async function updateTeamLifecycle(
  teamId: string,
  action: "archive" | "restore" | "delete"
): Promise<{ team: TeamRecord; rooms: ClientRoomRecord[] }> {
  const response = await fetch(`${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/lifecycle`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  const body = await readJsonResponse<{ team: TeamRecord; rooms: RoomRecord[] }>(response, "Failed to update team");
  const currentRooms = useAppStore.getState().rooms;
  return {
    team: body.team,
    rooms: body.rooms.map((room) =>
      ensureRoomDefaults(
        room,
        currentRooms.find((current) => current.id === room.id)
      )
    )
  };
}

export async function loadTeamMembers(teamId: string): Promise<TeamMemberRecord[]> {
  const response = await fetch(`${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/members`, {
    credentials: "include"
  });
  const body = await readJsonResponse<{ members: TeamMemberRecord[] }>(response, "Failed to load team members");
  return body.members as TeamMemberRecord[];
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: Exclude<TeamRole, "owner">
): Promise<TeamMemberRecord[]> {
  const response = await fetch(
    `${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role })
    }
  );
  const body = await readJsonResponse<{ members: TeamMemberRecord[] }>(response, "Failed to update team member role");
  return body.members as TeamMemberRecord[];
}

export async function transferTeamOwnership(teamId: string, userId: string): Promise<TeamMemberRecord[]> {
  const response = await fetch(
    `${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/transfer-owner`,
    {
      method: "POST",
      credentials: "include"
    }
  );
  const body = await readJsonResponse<{ members: TeamMemberRecord[] }>(response, "Failed to transfer team ownership");
  return body.members as TeamMemberRecord[];
}

export async function removeTeamMember(teamId: string, userId: string): Promise<TeamMemberRecord[]> {
  const response = await fetch(
    `${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      credentials: "include"
    }
  );
  const body = await readJsonResponse<{ members: TeamMemberRecord[] }>(response, "Failed to remove team member");
  return body.members as TeamMemberRecord[];
}

export async function registerDevice(request: DeviceRegistrationRequest): Promise<DeviceRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/devices`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const body = await readJsonResponse<{ device: DeviceRecord }>(response, "Failed to register device");
  return body.device as DeviceRecord;
}

export async function publishKeyPackages(deviceId: string, keyPackages: KeyPackageUpload[]): Promise<void> {
  const response = await fetch(`${getRelayHttpUrl()}/devices/${encodeURIComponent(deviceId)}/key-packages`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...deviceSessionHeaders() },
    body: JSON.stringify({ keyPackages })
  });
  await readJsonResponse<unknown>(response, "Failed to publish MLS KeyPackages");
}

export async function keyPackageCount(deviceId: string): Promise<number> {
  const response = await fetch(`${getRelayHttpUrl()}/devices/${encodeURIComponent(deviceId)}/key-packages/count`, {
    credentials: "include"
  });
  const body = await readJsonResponse<{ count: number }>(response, "Failed to count MLS KeyPackages");
  return body.count;
}

export async function consumeKeyPackage(
  roomId: string,
  userId: string,
  deviceId: string,
  hostDeviceId: string,
  inviteId: string,
  keyPackageId: string,
  keyPackageHash: string
): Promise<
  | { keyPackage: KeyPackageRecord; alreadyConsumed?: false }
  | { alreadyConsumed: true; keyPackageId: string; keyPackageHash: string; userId: string; deviceId: string }
> {
  const response = await fetch(
    `${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/key-packages/${encodeURIComponent(userId)}/${encodeURIComponent(deviceId)}/consume`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...deviceSessionHeaders() },
      body: JSON.stringify({ hostDeviceId, inviteId, keyPackageId, keyPackageHash })
    }
  );
  return readJsonResponse<
    | { keyPackage: KeyPackageRecord; alreadyConsumed?: false }
    | { alreadyConsumed: true; keyPackageId: string; keyPackageHash: string; userId: string; deviceId: string }
  >(response, "Failed to consume MLS KeyPackage");
}

export async function createRoom(
  teamId: string,
  name: string,
  projectPath: string,
  settings: RoomCreationSettings = {}
): Promise<ClientRoomRecord> {
  const {
    codexModel,
    codexModelPolicy,
    codexReasoningEffort,
    codexReasoningEffortPolicy,
    codexRawReasoningEnabled,
    codexSpeed,
    codexServiceTierPolicy,
    codexSandboxLevel,
    ...relaySettings
  } = settings;
  const response = await fetch(`${getRelayHttpUrl()}/rooms`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teamId, name, ...relaySettings })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to create room");
  return ensureRoomDefaults({
    ...body.room,
    projectPath,
    ...(codexModel === undefined ? {} : { codexModel }),
    ...(codexModelPolicy === undefined ? {} : { codexModelPolicy }),
    ...(codexReasoningEffort === undefined ? {} : { codexReasoningEffort }),
    ...(codexReasoningEffortPolicy === undefined ? {} : { codexReasoningEffortPolicy }),
    ...(codexRawReasoningEnabled === undefined ? {} : { codexRawReasoningEnabled }),
    ...(codexSpeed === undefined ? {} : { codexSpeed }),
    ...(codexServiceTierPolicy === undefined ? {} : { codexServiceTierPolicy }),
    ...(codexSandboxLevel === undefined ? {} : { codexSandboxLevel }),
    configRevision: 1,
    configEpoch: 0,
    configPending: false
  });
}

export async function updateRoomHost(
  roomId: string,
  host: string,
  hostUserId: string,
  hostDeviceId?: string
): Promise<ClientRoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/host`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json", ...deviceSessionHeaders() },
    body: JSON.stringify({ host, hostUserId, hostStatus: "active", hostDeviceId })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room host");
  const previous = useAppStore.getState().rooms.find((room) => room.id === roomId);
  return ensureRoomDefaults(body.room, previous);
}

export async function updateRoomSettings(
  roomId: string,
  settings: {
    name?: string;
    approvalPolicy?: ClientRoomRecord["approvalPolicy"];
    codexModel?: string;
    codexModelPolicy?: ClientRoomRecord["codexModelPolicy"];
    codexReasoningEffort?: ClientRoomRecord["codexReasoningEffort"];
    codexReasoningEffortPolicy?: ClientRoomRecord["codexReasoningEffortPolicy"];
    codexRawReasoningEnabled?: boolean;
    codexSpeed?: ClientRoomRecord["codexSpeed"];
    codexServiceTierPolicy?: ClientRoomRecord["codexServiceTierPolicy"];
    codexSandboxLevel?: ClientRoomRecord["codexSandboxLevel"];
    projectPath?: string;
    requesterName?: string;
    requesterUserId?: string;
  }
): Promise<ClientRoomRecord> {
  const {
    codexModel,
    codexModelPolicy,
    codexReasoningEffort,
    codexReasoningEffortPolicy,
    codexRawReasoningEnabled,
    codexSpeed,
    codexServiceTierPolicy,
    codexSandboxLevel,
    projectPath,
    ...relaySettings
  } = settings;
  const current = useAppStore.getState().rooms.find((room) => room.id === roomId);
  if (!current) throw new Error("Room configuration is unavailable on this device.");
  const nextConfig = {
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(codexModel !== undefined ? { codexModel } : {}),
    ...(codexModelPolicy !== undefined ? { codexModelPolicy } : {}),
    ...(codexReasoningEffort !== undefined ? { codexReasoningEffort } : {}),
    ...(codexReasoningEffortPolicy !== undefined ? { codexReasoningEffortPolicy } : {}),
    ...(codexRawReasoningEnabled !== undefined ? { codexRawReasoningEnabled } : {}),
    ...(codexSpeed !== undefined ? { codexSpeed } : {}),
    ...(codexServiceTierPolicy !== undefined ? { codexServiceTierPolicy } : {}),
    ...(codexSandboxLevel !== undefined ? { codexSandboxLevel } : {})
  };
  const hasRelayMutation = Object.keys(relaySettings).length > 0;
  if (!hasRelayMutation)
    return { ...current, ...nextConfig, configRevision: current.configRevision + 1, configPending: false };
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/settings`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(relaySettings)
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room settings");
  return ensureRoomDefaults(
    {
      ...body.room,
      ...nextConfig,
      configRevision: Object.keys(nextConfig).length > 0 ? current.configRevision + 1 : current.configRevision,
      configEpoch: current.configEpoch,
      configPending: false
    },
    current
  );
}

export async function updateRoomLifecycle(
  roomId: string,
  action: "archive" | "restore" | "delete",
  requester: { requesterName: string; requesterUserId: string }
): Promise<ClientRoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/lifecycle`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...requester })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room");
  const previous = useAppStore.getState().rooms.find((room) => room.id === roomId);
  return ensureRoomDefaults(body.room, previous);
}

export async function createInvite(teamId: string, roomId: string): Promise<InviteRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/invites`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teamId, roomId })
  });
  const body = await readJsonResponse<{ invite: InviteRecord }>(response, "Failed to create invite");
  return body.invite as InviteRecord;
}

export async function lookupInvite(inviteId: string): Promise<InviteLookupResult> {
  const response = await fetch(`${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}`, {
    credentials: "include"
  });
  const body = await readJsonResponse<Omit<InviteLookupResult, "room"> & { room: RoomRecord }>(
    response,
    "Failed to load invite metadata"
  );
  const previous = useAppStore.getState().rooms.find((room) => room.id === body.room.id);
  return { ...body, room: ensureRoomDefaults(body.room, previous) };
}

export async function publishDirectedInviteRequest(
  inviteId: string,
  request: Omit<DirectedInviteRequest, "requesterUserId" | "requesterDevice" | "createdAt">
): Promise<void> {
  const response = await fetch(`${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}/requests`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...deviceSessionHeaders() },
    body: JSON.stringify(request)
  });
  await readJsonResponse<unknown>(response, "Failed to publish invite request");
}

export async function loadDirectedInviteRequests(
  inviteId: string,
  hostDeviceId: string
): Promise<DirectedInviteRequest[]> {
  const params = new URLSearchParams({ hostDeviceId });
  const response = await fetch(
    `${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}/requests?${params.toString()}`,
    { credentials: "include", headers: deviceSessionHeaders() }
  );
  const body = await readJsonResponse<{ requests: DirectedInviteRequest[] }>(
    response,
    "Failed to load invite requests"
  );
  return body.requests;
}

export async function publishDirectedInviteResponse(
  inviteId: string,
  request: {
    hostDeviceId: string;
    requestId: string;
    status: "approved" | "denied";
    responseBinding: InviteResponseRecord["responseBinding"];
    responseMac: string;
    welcome?: string;
  }
): Promise<void> {
  const response = await fetch(`${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}/response`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...deviceSessionHeaders() },
    body: JSON.stringify(request)
  });
  await readJsonResponse<unknown>(response, "Failed to publish invite response");
}

type DirectedInviteResponse = Pick<InviteResponseRecord, "status" | "responseBinding" | "responseMac"> & {
  welcome?: string;
};

export function normalizeDirectedInviteResponse(
  directed: Pick<InviteResponseRecord, "status" | "responseBinding" | "responseMac" | "welcome">
): DirectedInviteResponse {
  return {
    status: directed.status,
    responseBinding: directed.responseBinding,
    responseMac: directed.responseMac,
    ...(directed.welcome ? { welcome: directed.welcome } : {})
  };
}

export async function loadDirectedInviteResponse(
  inviteId: string,
  requestId: string,
  requesterDeviceId: string
): Promise<DirectedInviteResponse | null> {
  const params = new URLSearchParams({ requesterDeviceId });
  const response = await fetch(
    `${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}/response/${encodeURIComponent(requestId)}?${params.toString()}`,
    { credentials: "include", headers: deviceSessionHeaders() }
  );
  if (response.status === 404) return null;
  const directed = await readJsonResponse<
    Pick<InviteResponseRecord, "status" | "responseBinding" | "responseMac" | "welcome">
  >(response, "Failed to load invite response");
  return normalizeDirectedInviteResponse(directed);
}

export async function acknowledgeDirectedInviteResponse(
  inviteId: string,
  requestId: string,
  requesterDeviceId: string
): Promise<void> {
  const response = await fetch(
    `${getRelayHttpUrl()}/invites/${encodeURIComponent(inviteId)}/response/${encodeURIComponent(requestId)}/ack`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...deviceSessionHeaders() },
      body: JSON.stringify({ requesterDeviceId })
    }
  );
  if (!response.ok) await readJsonResponse<unknown>(response, "Failed to acknowledge invite response");
}

export async function createAttachmentBlob(request: AttachmentBlobUploadRequest): Promise<AttachmentBlobRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/attachment-blobs`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const body = await readJsonResponse<{ blob: AttachmentBlobRecord }>(
    response,
    "Failed to upload encrypted attachment blob"
  );
  return body.blob as AttachmentBlobRecord;
}

export async function loadAttachmentBlob(
  blobId: string,
  teamId: string,
  roomId: string
): Promise<AttachmentBlobRecord> {
  const params = new URLSearchParams({ teamId, roomId });
  const response = await fetch(`${getRelayHttpUrl()}/attachment-blobs/${encodeURIComponent(blobId)}?${params}`, {
    credentials: "include"
  });
  const body = await readJsonResponse<{ blob: AttachmentBlobRecord }>(
    response,
    "Failed to load encrypted attachment blob"
  );
  return body.blob as AttachmentBlobRecord;
}
