import type {
  ApprovalPolicy,
  AttachmentBlobRecord,
  CiphertextPayload,
  DeviceRecord,
  InviteRecord,
  RoomRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamRole
} from "@multaiplayer/protocol";
import { getRelayHttpUrl } from "./appConfig";
import { readJsonResponse } from "./httpResponse";

export interface WorkspaceSnapshot {
  teams: TeamRecord[];
  rooms: RoomRecord[];
}

export interface InviteLookupResult {
  invite: InviteRecord;
  team: TeamRecord;
  room: RoomRecord;
}

export interface DeviceRegistrationRequest {
  userId: string;
  deviceId: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
}

export interface AttachmentBlobUploadRequest {
  teamId: string;
  roomId: string;
  name: string;
  type: string;
  size: number;
  payload: CiphertextPayload;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch(`${getRelayHttpUrl()}/teams`, { credentials: "include" });
  return readJsonResponse<WorkspaceSnapshot>(response, "Failed to load workspace");
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
): Promise<{ team: TeamRecord; rooms: RoomRecord[] }> {
  const response = await fetch(`${getRelayHttpUrl()}/teams/${encodeURIComponent(teamId)}/lifecycle`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  return readJsonResponse<{ team: TeamRecord; rooms: RoomRecord[] }>(response, "Failed to update team");
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

export async function createRoom(
  teamId: string,
  name: string,
  projectPath: string,
  settings: {
    approvalPolicy?: ApprovalPolicy;
    approvalDelegationPolicy?: RoomRecord["approvalDelegationPolicy"];
    trustedApproverUserIds?: string[];
    codexModel?: string;
    codexModelPolicy?: RoomRecord["codexModelPolicy"];
    codexReasoningEffort?: RoomRecord["codexReasoningEffort"];
    codexReasoningEffortPolicy?: RoomRecord["codexReasoningEffortPolicy"];
    codexSpeed?: RoomRecord["codexSpeed"];
    codexServiceTierPolicy?: RoomRecord["codexServiceTierPolicy"];
    codexSandboxLevel?: RoomRecord["codexSandboxLevel"];
    browserAllowedOrigins?: string[];
    browserProfilePersistent?: boolean;
  } = {}
): Promise<RoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ teamId, name, projectPath, ...settings })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to create room");
  return body.room as RoomRecord;
}

export async function updateRoomHost(
  roomId: string,
  host: string,
  hostUserId: string,
  hostStatus: RoomRecord["hostStatus"]
): Promise<RoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/host`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host, hostUserId, hostStatus })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room host");
  return body.room as RoomRecord;
}

export async function updateRoomSettings(
  roomId: string,
  settings: {
    name?: string;
    approvalPolicy?: RoomRecord["approvalPolicy"];
    approvalDelegationPolicy?: RoomRecord["approvalDelegationPolicy"];
    trustedApproverUserIds?: string[];
    mode?: RoomRecord["mode"];
    codexModel?: string;
    codexModelPolicy?: RoomRecord["codexModelPolicy"];
    codexReasoningEffort?: RoomRecord["codexReasoningEffort"];
    codexReasoningEffortPolicy?: RoomRecord["codexReasoningEffortPolicy"];
    codexSpeed?: RoomRecord["codexSpeed"];
    codexServiceTierPolicy?: RoomRecord["codexServiceTierPolicy"];
    codexSandboxLevel?: RoomRecord["codexSandboxLevel"];
    projectPath?: string;
    browserAllowedOrigins?: string[];
    browserProfilePersistent?: boolean;
    requesterName?: string;
    requesterUserId?: string;
  }
): Promise<RoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/settings`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room settings");
  return body.room as RoomRecord;
}

export async function updateRoomLifecycle(
  roomId: string,
  action: "archive" | "restore" | "delete",
  requester: { requesterName: string; requesterUserId: string }
): Promise<RoomRecord> {
  const response = await fetch(`${getRelayHttpUrl()}/rooms/${encodeURIComponent(roomId)}/lifecycle`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...requester })
  });
  const body = await readJsonResponse<{ room: RoomRecord }>(response, "Failed to update room");
  return body.room as RoomRecord;
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
  return readJsonResponse<InviteLookupResult>(response, "Failed to load invite metadata");
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
