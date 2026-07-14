import { invokeNative, isNativeCommandErrorCode } from "./nativeCommandError";
import { reportExpectedFailure } from "./nonFatalReporting";

export interface MlsIdentityPublic {
  githubUserId: string;
  deviceId: string;
  ciphersuite: 2;
  signaturePublicKey: string;
  signatureKeyFingerprint: string;
  hpkePublicKey: string;
  hpkeKeyFingerprint: string;
  requiresRejoin: boolean;
}

export interface MlsAuthenticatedData {
  version: 1;
  epoch: number;
  messageId: string;
  teamId: string;
  roomId: string;
  kind: string;
  senderUserId: string;
  senderDeviceId: string;
  createdAt: string;
}

export interface MlsGroupState {
  roster: Array<{ leaf: number; githubUserId: string; deviceId: string }>;
  selfLeaf: number;
  epoch: number;
}

export interface MlsBlobCiphertext {
  version: number;
  epoch: number;
  nonce: string;
  ciphertext: string;
}

export interface MlsIncomingApplication {
  senderLeaf: number;
  epoch: number;
  authenticatedData: string;
  payload: string;
}

export interface MlsInviteSealedPayload {
  version: 1;
  kem_id: number;
  kdf_id: number;
  aead_id: number;
  encapsulated_key: number[];
  ciphertext: number[];
}

export interface MlsKeyPackageUpload {
  id: string;
  keyPackage: string;
  keyPackageHash: string;
  ciphersuite: 2;
}

export interface MlsOutboxItem {
  id: string;
  roomId: string;
  epoch: number;
  kind: string;
  payload: string;
  metadata?:
    | { type: "application"; authenticatedData: number[] }
    | { type: "commit"; parentEpoch: number }
    | {
        type: "welcome";
        inviteId: string;
        requestId: string;
        requesterUserId: string;
        requesterDeviceId: string;
        keyPackageId: string;
        keyPackageHash: string;
        responseBinding: MlsInviteCapabilityBinding;
        responseMac: string;
      }
    | ({ type: "hostTransfer" } & MlsHostTransferAuthorization["authorization"])
    | { type: "inviteResponse"; binding: MlsInviteCapabilityBinding; mac: string }
    | null;
}

export interface MlsInviteCapabilityBinding {
  version: 3;
  phase: "request" | "response";
  inviteId: string;
  teamId: string;
  roomId: string;
  keyEpoch: number;
  keyPackageHash: string;
  requestId: string;
  requestNonce: string;
  requesterUserId: string;
  requesterDeviceId: string;
  hostUserId: string;
  hostDeviceId: string;
  expiresAt: string;
  status: "approved" | "denied" | null;
  decidedAt: string | null;
}

export async function initializeMlsIdentity(githubUserId: string, deviceId: string): Promise<MlsIdentityPublic> {
  return invokeNative("mls_identity_initialize", { request: { githubUserId, deviceId } });
}

export async function signDeviceChallenge(
  challenge: string
): Promise<{ signatureDer: string; publicKeySpkiDer: string }> {
  return invokeNative("mls_device_auth_sign", { request: { challenge } });
}

export async function generateMlsKeyPackage(): Promise<MlsKeyPackageUpload> {
  return invokeNative("mls_generate_key_package");
}

export async function createMlsGroup(roomId: string): Promise<number> {
  return invokeNative("mls_create_group", { request: { roomId } });
}

export async function openMlsGroup(roomId: string): Promise<number> {
  return invokeNative("mls_group_open", { request: { roomId } });
}

export async function forgetCorruptMlsGroup(roomId: string): Promise<void> {
  return invokeNative("mls_forget_corrupt_group", { request: { roomId } });
}

export function isMlsRequiresRejoin(error: unknown): boolean {
  return isNativeCommandErrorCode(error, "requires_rejoin");
}

export async function joinMlsWelcome(roomId: string, welcome: string): Promise<number> {
  return invokeNative("mls_join_welcome", { request: { roomId, welcome } });
}

export async function encryptMlsApplication(
  roomId: string,
  authenticatedData: Omit<MlsAuthenticatedData, "epoch">,
  payload: unknown
): Promise<{ message: string; outboxId: string; epoch: number; authenticatedData: string }> {
  const result = await invokeNative<{ message: string; outboxId: string; epoch: number; authenticatedData: string }>(
    "mls_encrypt_application",
    {
      request: {
        roomId,
        messageId: authenticatedData.messageId,
        authenticatedData,
        payload: encodeUtf8(JSON.stringify(payload))
      }
    }
  );
  const canonical = parseMlsAuthenticatedData(result.authenticatedData);
  if (
    !canonical ||
    canonical.epoch !== result.epoch ||
    serializeMlsAuthenticatedData(canonical) !== result.authenticatedData
  )
    throw new Error("Native MLS encryption returned invalid authenticated routing data.");
  if (serializeMlsAuthenticatedData({ ...authenticatedData, epoch: result.epoch }) !== result.authenticatedData)
    throw new Error("Native MLS encryption changed authenticated routing data.");
  return result;
}

export async function retireStaleMlsApplication(roomId: string, messageId: string): Promise<number> {
  return invokeNative("mls_retire_stale_application", { request: { roomId, messageId } });
}

export async function setMlsHistoryRetention(roomId: string, retentionDays: number): Promise<void> {
  return invokeNative("mls_history_retention_set", { request: { roomId, retentionDays } });
}

export async function processMlsIncoming(roomId: string, message: string): Promise<MlsIncomingApplication | null> {
  return invokeNative("mls_process_incoming", { request: { roomId, message } });
}

export async function removeMlsMember(
  roomId: string,
  leaf: number
): Promise<{ message: string; outboxId: string; parentEpoch: number }> {
  return invokeNative("mls_remove_member", { request: { roomId, leaf } });
}

export async function transferMlsHost(
  roomId: string,
  nextHostLeaf: number,
  nextHostDeviceId: string
): Promise<{ message: string; outboxId: string; parentEpoch: number }> {
  return invokeNative("mls_transfer_host", { request: { roomId, nextHostLeaf, nextHostDeviceId } });
}

export async function currentMlsEpoch(roomId: string): Promise<number> {
  return invokeNative("mls_current_epoch", { request: { roomId } });
}

export async function mlsGroupState(roomId: string): Promise<MlsGroupState> {
  return invokeNative("mls_group_state", { request: { roomId } });
}

export async function markMlsPublishSucceeded(roomId: string, messageId: string): Promise<number> {
  return invokeNative("mls_publish_succeeded", { request: { roomId, messageId } });
}

export async function clearPendingMlsCommit(roomId: string, expectedMessageId: string): Promise<number> {
  return invokeNative("mls_clear_pending_commit", { request: { roomId, expectedMessageId } });
}

export async function issueMlsInviteCapability(): Promise<{
  capabilityHandle: string;
  capabilityUrlValue: string;
}> {
  return invokeNative("mls_invite_capability_issue");
}

export async function sealMlsInviteRequest(
  recipientHpkePublicKey: string,
  capabilityHandle: string,
  capabilityUrlValue: string,
  binding: MlsInviteCapabilityBinding,
  keyPackage: string,
  keyPackageId: string
): Promise<{ keyPackageHash: string; sealedRequest: string }> {
  return invokeNative("mls_invite_request_seal", {
    request: { recipientHpkePublicKey, capabilityHandle, capabilityUrlValue, binding, keyPackage, keyPackageId }
  });
}

export async function openMlsInviteRequest(
  binding: MlsInviteCapabilityBinding,
  sealedPayload: MlsInviteSealedPayload
): Promise<{
  capabilityHandle: string;
  binding: MlsInviteCapabilityBinding;
  keyPackage: string;
  mac: string;
  requesterSignaturePublicKey: string;
  requesterSignatureKeyFingerprint: string;
}> {
  return invokeNative("mls_invite_request_open", { request: { binding, sealedPayload } });
}

export async function approveMlsInvite(
  capabilityHandle: string,
  binding: MlsInviteCapabilityBinding,
  mac: string,
  keyPackage: string,
  keyPackageId: string
): Promise<{
  epoch: number;
  commitOutboxId: string;
  welcomeOutboxId: string;
  responseBinding: MlsInviteCapabilityBinding;
  responseMac: string;
  requesterSignaturePublicKey: string;
  requesterSignatureKeyFingerprint: string;
}> {
  return invokeNative("mls_invite_approve", {
    request: { capabilityHandle, binding, mac, keyPackage, keyPackageId }
  });
}

export async function denyMlsInvite(
  capabilityHandle: string,
  binding: MlsInviteCapabilityBinding,
  mac: string
): Promise<{ outboxId: string; responseBinding: MlsInviteCapabilityBinding; responseMac: string }> {
  return invokeNative("mls_invite_deny", { request: { capabilityHandle, binding, mac } });
}

export async function acceptMlsInviteResponse(
  capabilityUrlValue: string,
  originalBinding: MlsInviteCapabilityBinding,
  responseBinding: MlsInviteCapabilityBinding,
  responseMac: string,
  welcome?: string
): Promise<{ status: "approved" | "denied"; epoch?: number }> {
  return invokeNative("mls_invite_response_accept", {
    request: { capabilityUrlValue, originalBinding, responseBinding, responseMac, ...(welcome ? { welcome } : {}) }
  });
}

export interface PendingMlsInviteRequest {
  inviteId: string;
  teamId: string;
  roomId: string;
  requestId: string;
  requesterUserId: string;
  requesterDeviceId: string;
  keyPackageId: string;
  keyPackageHash: string;
  expiresAt: string;
  sealedRequest: string;
}

export async function listPendingMlsInviteRequests(): Promise<PendingMlsInviteRequest[]> {
  return invokeNative("mls_pending_invite_requests_list");
}

export async function acceptPendingMlsInviteResponse(
  requestId: string,
  responseBinding: MlsInviteCapabilityBinding,
  responseMac: string,
  welcome?: string
): Promise<{ status: "approved" | "denied"; epoch?: number }> {
  return invokeNative("mls_pending_invite_response_accept", {
    request: { requestId, responseBinding, responseMac, ...(welcome ? { welcome } : {}) }
  });
}

export async function completePendingMlsInviteRequest(requestId: string, roomId: string): Promise<void> {
  return invokeNative("mls_pending_invite_complete", { request: { requestId, roomId } });
}

export async function listMlsOutbox(): Promise<MlsOutboxItem[]> {
  return invokeNative("mls_outbox_list");
}

export interface MlsJoinAdmission {
  inviteId: string;
  teamId: string;
  roomId: string;
  requestId: string;
  requesterUserId: string;
  requesterDeviceId: string;
}

export async function listMlsJoinAdmissions(): Promise<MlsJoinAdmission[]> {
  return invokeNative("mls_join_admissions_list");
}

export async function completeMlsJoinAdmission(roomId: string, requestId: string): Promise<void> {
  return invokeNative("mls_join_admission_complete", { request: { roomId, requestId } });
}

export async function findMlsOutboxMessage(roomId: string, payload: string, kind?: string): Promise<MlsOutboxItem> {
  const item = (await listMlsOutbox()).find(
    (candidate) => candidate.roomId === roomId && candidate.payload === payload && (!kind || candidate.kind === kind)
  );
  if (!item) throw new Error("Native MLS outbox does not contain the persisted message.");
  return item;
}

export interface MlsHostTransferAuthorization {
  authorization: {
    version: 1;
    roomId: string;
    commitMessageId: string;
    parentEpoch: number;
    outgoingHostUserId: string;
    outgoingHostDeviceId: string;
    nextHostUserId: string;
    nextHostDeviceId: string;
    nextHostLeaf: number;
  };
  signatureDer: string;
  publicKeySpkiDer: string;
}

export async function authorizeMlsHostTransfer(
  roomId: string,
  commitMessageId: string
): Promise<MlsHostTransferAuthorization> {
  return invokeNative("mls_host_transfer_authorization", { request: { roomId, commitMessageId } });
}

export async function encryptMlsBlob(roomId: string, blobId: string, plaintext: unknown): Promise<MlsBlobCiphertext> {
  return invokeNative("mls_blob_encrypt", {
    request: { roomId, blobId, plaintext: encodeUtf8(JSON.stringify(plaintext)) }
  });
}

export async function decryptMlsBlob(roomId: string, blobId: string, value: MlsBlobCiphertext): Promise<unknown> {
  const plaintext = await invokeNative<string>("mls_blob_decrypt", { request: { roomId, blobId, value } });
  return JSON.parse(decodeUtf8(plaintext)) as unknown;
}

export function decodeMlsApplicationPayload(value: string): unknown {
  return JSON.parse(decodeUtf8(value)) as unknown;
}

export function parseMlsAuthenticatedData(value: string): MlsAuthenticatedData | null {
  try {
    const parsed = JSON.parse(value) as Partial<MlsAuthenticatedData>;
    if (
      parsed.version !== 1 ||
      !Number.isSafeInteger(parsed.epoch) ||
      (parsed.epoch ?? -1) < 0 ||
      typeof parsed.messageId !== "string" ||
      !parsed.messageId ||
      typeof parsed.teamId !== "string" ||
      !parsed.teamId ||
      typeof parsed.roomId !== "string" ||
      !parsed.roomId ||
      typeof parsed.kind !== "string" ||
      !parsed.kind ||
      typeof parsed.senderUserId !== "string" ||
      !parsed.senderUserId ||
      typeof parsed.senderDeviceId !== "string" ||
      !parsed.senderDeviceId ||
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      Object.keys(parsed).some(
        (key) =>
          ![
            "version",
            "epoch",
            "messageId",
            "teamId",
            "roomId",
            "kind",
            "senderUserId",
            "senderDeviceId",
            "createdAt"
          ].includes(key)
      )
    )
      return null;
    return {
      version: 1,
      epoch: parsed.epoch!,
      messageId: parsed.messageId,
      teamId: parsed.teamId,
      roomId: parsed.roomId,
      kind: parsed.kind,
      senderUserId: parsed.senderUserId,
      senderDeviceId: parsed.senderDeviceId,
      createdAt: parsed.createdAt
    };
  } catch {
    reportExpectedFailure("MLS authenticated-data parser rejected malformed input");
    return null;
  }
}

function serializeMlsAuthenticatedData(value: MlsAuthenticatedData): string {
  return JSON.stringify({
    version: value.version,
    epoch: value.epoch,
    messageId: value.messageId,
    teamId: value.teamId,
    roomId: value.roomId,
    kind: value.kind,
    senderUserId: value.senderUserId,
    senderDeviceId: value.senderDeviceId,
    createdAt: value.createdAt
  });
}

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUtf8(value: string): string {
  const binary = atob(value);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}
