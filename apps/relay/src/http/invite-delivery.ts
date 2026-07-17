import { sendRelayError } from "./errors.js";
import type { Express, Response } from "express";
import {
  InviteResponseRecord,
  type InviteRecord,
  type InviteJoinRequestRecord,
  type InviteResponseRecord as InviteResponseRecordType,
  type KeyPackageRecord,
  type RoomRecord
} from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import { hasDeviceSession } from "./device-auth.js";
import {
  isCanonicalPaddedBase64,
  parseStrictDirectedInviteRequestJson,
  type StrictDirectedInviteRequest
} from "../opaque.js";
import { isActiveInviteTarget } from "../relay-domain.js";
import { persistMutationOrRollback } from "./durable-mutation.js";
import { ackInviteResponseAtomically, inviteIsExpired } from "./invite-ack-transaction.js";

const maxOpaqueChars = 1_400_000;
interface Options {
  app: Express;
  store: RelayStore;
  getAuthSession: (id: unknown) => AuthSession | null;
  allowRead: (s: AuthSession | null, r: Response) => boolean;
  allowMutation: (s: AuthSession | null, r: Response) => boolean;
  saveRelayStore: () => Promise<void>;
  notifyInviteRequested: (inviteId: string, requestId: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxDeviceIdChars: number;
  maxEnvelopeIdChars: number;
}

export function registerInviteDeliveryRoutes({
  app,
  store,
  getAuthSession,
  allowRead,
  allowMutation,
  saveRelayStore,
  notifyInviteRequested,
  normalizeMetadataText,
  maxDeviceIdChars,
  maxEnvelopeIdChars
}: Options) {
  const requestSaves = new Map<string, Promise<boolean>>();
  app.post("/invites/:inviteId/requests", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) return void sendRelayError(res, 401, "authentication_required", "Sign in before requesting to join.");
    const invite = store.getInvite(String(req.params.inviteId));
    const requestId = normalizeMetadataText(body.requestId, maxEnvelopeIdChars);
    const requesterDeviceId = normalizeMetadataText(body.requesterDeviceId, maxDeviceIdChars);
    const keyPackageId = normalizeMetadataText(body.keyPackageId, maxEnvelopeIdChars);
    const keyPackageHash = String(body.keyPackageHash ?? "");
    const sealedRequest = String(body.sealedRequest ?? "");
    if (!hasExactKeys(body, ["requestId", "requesterDeviceId", "keyPackageId", "keyPackageHash", "sealedRequest"]))
      return void sendRelayError(res, 400, "invalid_request", "Invite request contains unsupported fields.");
    if (!requestId || !requesterDeviceId || !keyPackageId)
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite request identifiers.");
    const kp = store.keyPackages.get(keyPackageId);
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, requesterDeviceId))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (!invite) return void sendRelayError(res, 404, "invite_not_found", "Invite not found.");
    if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now())
      return void sendRelayError(res, 410, "invite_expired", "Invite expired.");
    if (!isActiveInviteTarget(store, invite))
      return void sendRelayError(res, 409, "conflict", "Restore the team and room before using this invite.");
    const existingRequest = store.inviteRequests.get(requestId);
    if (existingRequest) {
      return void (await respondToExistingInviteRequest({
        existingRequest,
        invite,
        session,
        requesterDeviceId,
        keyPackageId,
        keyPackageHash,
        sealedRequest,
        pendingSave: requestSaves.get(requestId),
        res
      }));
    }
    const pendingConflict = pendingInviteConflict(store, invite);
    if (pendingConflict) return void sendRelayError(res, 409, "conflict", pendingConflict);
    const directed = parseStrictDirectedInviteRequestJson(sealedRequest, maxOpaqueChars);
    const room = store.getRoom(invite.roomId);
    if (
      !isValidDirectedInviteRequest(
        kp,
        directed,
        invite,
        room,
        requestId,
        session.user.id,
        requesterDeviceId,
        keyPackageHash
      )
    ) {
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite request.");
    }
    const record: InviteJoinRequestRecord = {
      requestId,
      inviteId: invite.id,
      requesterUserId: session.user.id,
      requesterDeviceId,
      keyPackageId,
      keyPackageHash,
      sealedRequest,
      createdAt: new Date().toISOString()
    };
    if (!(await saveInviteRequestAtomically(store, record, requestSaves, saveRelayStore))) {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist invite request.");
    }
    notifyInviteRequested(invite.id, requestId);
    res.status(201).json({ requestId, status: "pending" });
  });

  app.get("/invites/:inviteId/requests", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const invite = store.getInvite(String(req.params.inviteId ?? ""));
    const room = invite && store.getRoom(invite.roomId);
    if (
      !session ||
      !invite ||
      !isActiveInviteTarget(store, invite) ||
      !room ||
      room.hostUserId !== session.user.id ||
      room.activeHostDeviceId !== String(req.query.hostDeviceId ?? "")
    )
      return void sendRelayError(res, 403, "forbidden", "Only the active host device may read invite requests.");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, room.activeHostDeviceId!))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (inviteIsExpired(invite)) return void sendRelayError(res, 410, "invite_expired", "Invite expired.");
    const requests = Array.from(store.inviteRequests.values())
      .filter((item) => item.inviteId === invite.id)
      .map((item) => {
        const registeredRequesterDevice = store.getDevice(item.requesterUserId, item.requesterDeviceId);
        return {
          ...item,
          requesterDevice: registeredRequesterDevice
            ? {
                userId: registeredRequesterDevice.userId,
                deviceId: registeredRequesterDevice.deviceId,
                signaturePublicKey: registeredRequesterDevice.signaturePublicKey,
                signatureKeyFingerprint: registeredRequesterDevice.signatureKeyFingerprint
              }
            : null
        };
      });
    // This host-only, device-authenticated response projects only the public
    // identity bound to each request. A pending invitee is not in the team
    // directory until admission, so directory enumeration cannot verify it.
    res.json({ requests });
  });

  app.post("/invites/:inviteId/response", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const context = prepareInviteResponse(
      store,
      String(req.params.inviteId),
      body,
      session,
      req.get("x-device-session"),
      res
    );
    if (!context) return;
    const { invite, room, request, status, welcome, hostUserId } = context;
    const candidate = {
      requestId: request.requestId,
      inviteId: request.inviteId,
      requesterUserId: request.requesterUserId,
      requesterDeviceId: request.requesterDeviceId,
      keyPackageHash: request.keyPackageHash,
      status,
      responseBinding: body.responseBinding,
      responseMac: body.responseMac,
      welcome,
      createdAt: new Date().toISOString()
    };
    const record = validInviteResponseRecord(candidate, invite, request, hostUserId, room);
    if (!record)
      return void sendRelayError(res, 400, "invalid_request", "Invite response binding does not match its request.");
    if (!membershipCommitAcceptedForWelcome(record, room)) {
      return void sendRelayError(
        res,
        409,
        "conflict",
        "The membership Commit must be durably accepted before publishing its Welcome."
      );
    }
    if (!(await saveInviteResponseAtomically(store, request, record, saveRelayStore))) {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist invite response.");
    }
    res.status(201).json({ requestId: record.requestId, status: "ready" });
  });

  app.get("/invites/:inviteId/response/:requestId", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const record = store.inviteResponses.get(String(req.params.requestId ?? ""));
    const invite = record && store.getInvite(record.inviteId);
    if (
      session &&
      record &&
      !hasDeviceSession(store, req.get("x-device-session"), session.user.id, record.requesterDeviceId)
    )
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (
      !session ||
      !record ||
      !invite ||
      inviteIsExpired(invite) ||
      !isActiveInviteTarget(store, invite) ||
      record.inviteId !== String(req.params.inviteId) ||
      record.requesterUserId !== session.user.id ||
      record.requesterDeviceId !== String(req.query.requesterDeviceId ?? "")
    )
      return void sendRelayError(res, 404, "not_found", "Welcome not found.");
    res.json({
      status: record.status,
      responseBinding: record.responseBinding,
      responseMac: record.responseMac,
      ...(record.welcome ? { welcome: record.welcome } : {})
    });
  });

  app.post("/invites/:inviteId/response/:requestId/ack", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!hasExactKeys(req.body, ["requesterDeviceId"]))
      return void sendRelayError(res, 400, "invalid_request", "Invite response ACK contains unsupported fields.");
    const requesterDeviceId = String(req.body.requesterDeviceId ?? "");
    const record = store.inviteResponses.get(String(req.params.requestId ?? ""));
    if (!session) return void sendRelayError(res, 404, "invite_not_found", "Invite response not found.");
    if (!record) {
      if (
        isExactInviteAckReceipt(
          store,
          String(req.params.inviteId),
          String(req.params.requestId ?? ""),
          session.user.id,
          requesterDeviceId
        ) &&
        hasDeviceSession(store, req.get("x-device-session"), session.user.id, requesterDeviceId)
      )
        return void res.status(204).end();
      return void sendRelayError(res, 404, "invite_not_found", "Invite response not found.");
    }
    if (
      record.inviteId !== String(req.params.inviteId) ||
      record.requesterUserId !== session.user.id ||
      record.requesterDeviceId !== requesterDeviceId ||
      !hasDeviceSession(store, req.get("x-device-session"), session.user.id, record.requesterDeviceId)
    )
      return void sendRelayError(res, 404, "invite_not_found", "Invite response not found.");
    const result = await ackInviteResponseAtomically(store, record, saveRelayStore);
    if (result === "expired") return void sendRelayError(res, 410, "invite_expired", "Invite expired.");
    if (result === "missing_team")
      return void sendRelayError(res, 404, "invite_not_found", "Invite response team not found.");
    if (result === "revoked")
      return void sendRelayError(res, 409, "conflict", "Invite approval was revoked before ACK.");
    if (result === "inactive_target")
      return void sendRelayError(res, 409, "conflict", "Restore the team and room before acknowledging this invite.");
    if (result === "persistence_failed") {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not acknowledge invite response durably.");
    }
    res.status(204).end();
  });
}

function inviteResponseWelcome(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("welcome" in body)) return undefined;
  return typeof body.welcome === "string" ? body.welcome : undefined;
}

function inviteResponseKeys(status: unknown): string[] {
  const common = ["hostDeviceId", "requestId", "status", "responseBinding", "responseMac"];
  return status === "approved" ? [...common, "welcome"] : common;
}

function isSameInviteRequest(
  existing: InviteJoinRequestRecord,
  inviteId: string,
  requesterUserId: string,
  requesterDeviceId: string,
  keyPackageId: string,
  keyPackageHash: string,
  sealedRequest: string
): boolean {
  return (
    existing.inviteId === inviteId &&
    existing.requesterUserId === requesterUserId &&
    existing.requesterDeviceId === requesterDeviceId &&
    existing.keyPackageId === keyPackageId &&
    existing.keyPackageHash === keyPackageHash &&
    existing.sealedRequest === sealedRequest
  );
}

function inviteHasPendingDecision(store: RelayStore, invite: InviteRecord): boolean {
  return (
    Array.from(store.inviteResponses.values()).some((response) => response.inviteId === invite.id) ||
    invite.approvedUserId !== undefined ||
    invite.approvedDeviceId !== undefined ||
    invite.keyPackageHash !== undefined
  );
}

function isValidDirectedInviteRequest(
  keyPackage: KeyPackageRecord | undefined,
  directed: StrictDirectedInviteRequest | null,
  invite: InviteRecord,
  room: RoomRecord | undefined,
  requestId: string,
  requesterUserId: string,
  requesterDeviceId: string,
  keyPackageHash: string
): boolean {
  if (!keyPackage || !directed) return false;
  const binding = directed.binding;
  return (
    keyPackage.userId === requesterUserId &&
    keyPackage.deviceId === requesterDeviceId &&
    keyPackage.keyPackageHash === keyPackageHash &&
    binding.inviteId === invite.id &&
    binding.teamId === invite.teamId &&
    binding.roomId === invite.roomId &&
    binding.keyEpoch === (room?.acceptedMlsEpoch ?? 0) &&
    binding.keyPackageHash === keyPackageHash &&
    binding.requestId === requestId &&
    binding.requesterUserId === requesterUserId &&
    binding.requesterDeviceId === requesterDeviceId &&
    binding.hostUserId === room?.hostUserId &&
    binding.hostDeviceId === room?.activeHostDeviceId &&
    binding.expiresAt === invite.expiresAt
  );
}

async function saveInviteRequestAtomically(
  store: RelayStore,
  record: InviteJoinRequestRecord,
  pendingSaves: Map<string, Promise<boolean>>,
  saveRelayStore: () => Promise<void>
): Promise<boolean> {
  store.inviteRequests.set(record.requestId, record);
  const saveResult = saveRelayStore().then(
    () => true,
    () => false
  );
  pendingSaves.set(record.requestId, saveResult);
  const persisted = await saveResult;
  if (pendingSaves.get(record.requestId) === saveResult) pendingSaves.delete(record.requestId);
  if (!persisted) store.inviteRequests.delete(record.requestId);
  return persisted;
}

function membershipCommitAcceptedForWelcome(record: InviteResponseRecordType, room: RoomRecord): boolean {
  return record.status !== "approved" || room.acceptedMlsEpoch === record.responseBinding.keyEpoch + 1;
}

interface InviteResponseAttempt {
  inviteId: string;
  status: unknown;
  responseMac: unknown;
  responseBinding: unknown;
  welcome: string | undefined;
}

interface PreparedInviteResponse {
  invite: InviteRecord;
  room: RoomRecord;
  request: InviteJoinRequestRecord;
  status: unknown;
  welcome: string | undefined;
  hostUserId: string;
}

function prepareInviteResponse(
  store: RelayStore,
  inviteId: string,
  body: Record<string, unknown>,
  session: AuthSession | null,
  deviceSessionToken: string | undefined,
  res: Response
): PreparedInviteResponse | null {
  const invite = store.getInvite(inviteId);
  const room = invite && store.getRoom(invite.roomId);
  const request = store.inviteRequests.get(String(body.requestId ?? ""));
  const status = body.status;
  const welcome = inviteResponseWelcome(body);
  if (!hasExactKeys(body, inviteResponseKeys(status))) {
    sendRelayError(res, 400, "invalid_request", "Invite response contains unsupported fields.");
    return null;
  }
  if (!isActiveInviteHost(session, room, String(body.hostDeviceId ?? ""), isActiveInviteTarget(store, invite))) {
    sendRelayError(res, 403, "forbidden", "An active room and host device are required.");
    return null;
  }
  if (!session || !room || !invite) return null;
  if (!hasDeviceSession(store, deviceSessionToken, session.user.id, room.activeHostDeviceId!)) {
    sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    return null;
  }
  if (inviteIsExpired(invite)) {
    sendRelayError(res, 410, "invite_expired", "Invite expired.");
    return null;
  }
  const existing = store.inviteResponses.get(String(body.requestId ?? ""));
  if (existing) {
    respondToExistingInviteResponse({
      existing,
      attempt: {
        inviteId: invite.id,
        status,
        responseMac: body.responseMac,
        responseBinding: body.responseBinding,
        welcome
      },
      res
    });
    return null;
  }
  const preconditionError = inviteResponsePreconditionError(invite, request, status, welcome);
  if (preconditionError) {
    sendRelayError(res, preconditionError.status, preconditionError.code, preconditionError.message);
    return null;
  }
  return request ? { invite, room, request, status, welcome, hostUserId: session.user.id } : null;
}

interface ExistingInviteResponseContext {
  existing: InviteResponseRecordType;
  attempt: InviteResponseAttempt;
  res: Response;
}

function respondToExistingInviteResponse({ existing, attempt, res }: ExistingInviteResponseContext): void {
  if (isSameInviteResponse(existing, attempt)) {
    res.status(200).json({ requestId: existing.requestId, status: "ready" });
    return;
  }
  sendRelayError(res, 409, "conflict", "requestId is already bound to another invite response.");
}

function isSameInviteResponse(existing: InviteResponseRecordType, attempt: InviteResponseAttempt): boolean {
  return (
    existing.inviteId === attempt.inviteId &&
    existing.status === attempt.status &&
    existing.responseMac === attempt.responseMac &&
    JSON.stringify(existing.responseBinding) === JSON.stringify(attempt.responseBinding) &&
    existing.welcome === attempt.welcome
  );
}

function isApprovedInviteRequest(invite: InviteRecord, request: InviteJoinRequestRecord): boolean {
  return (
    invite.approvedUserId === request.requesterUserId &&
    invite.approvedDeviceId === request.requesterDeviceId &&
    invite.keyPackageHash === request.keyPackageHash
  );
}

function inviteResponseBindingMatches(
  record: InviteResponseRecordType,
  invite: InviteRecord,
  request: InviteJoinRequestRecord,
  hostUserId: string,
  room: RoomRecord
): boolean {
  const binding = record.responseBinding;
  const directed = parseStrictDirectedInviteRequestJson(request.sealedRequest, maxOpaqueChars);
  if (!directed) return false;
  return (
    binding.keyEpoch === directed.binding.keyEpoch &&
    binding.requestNonce === directed.binding.requestNonce &&
    binding.expiresAt === directed.binding.expiresAt &&
    binding.inviteId === invite.id &&
    binding.teamId === invite.teamId &&
    binding.roomId === invite.roomId &&
    binding.requestId === request.requestId &&
    binding.keyPackageHash === request.keyPackageHash &&
    binding.requesterUserId === request.requesterUserId &&
    binding.requesterDeviceId === request.requesterDeviceId &&
    binding.hostUserId === hostUserId &&
    binding.hostDeviceId === room.activeHostDeviceId &&
    binding.status === record.status
  );
}

async function saveInviteResponseAtomically(
  store: RelayStore,
  request: InviteJoinRequestRecord,
  record: InviteResponseRecordType,
  saveRelayStore: () => Promise<void>
): Promise<boolean> {
  store.inviteRequests.delete(request.requestId);
  store.inviteResponses.set(record.requestId, record);
  return persistMutationOrRollback({
    persist: saveRelayStore,
    rollback: () => {
      store.inviteResponses.delete(record.requestId);
      store.inviteRequests.set(request.requestId, request);
    }
  });
}

export function isExactInviteAckReceipt(
  store: RelayStore,
  inviteId: string,
  requestId: string,
  requesterUserId: string,
  requesterDeviceId: string,
  now = Date.now()
): boolean {
  const receipt = store.inviteAckReceipts.get(requestId);
  return Boolean(
    receipt &&
    receipt.inviteId === inviteId &&
    receipt.requesterUserId === requesterUserId &&
    receipt.requesterDeviceId === requesterDeviceId &&
    (receipt.status === "denied" || store.hasTeamMember(receipt.teamId, requesterUserId)) &&
    Date.parse(receipt.expiresAt) > now
  );
}

async function respondToExistingInviteRequest(options: {
  existingRequest: InviteJoinRequestRecord;
  invite: InviteRecord;
  session: AuthSession;
  requesterDeviceId: string;
  keyPackageId: string;
  keyPackageHash: string;
  sealedRequest: string;
  pendingSave: Promise<boolean> | undefined;
  res: Response;
}): Promise<void> {
  const same = isSameInviteRequest(
    options.existingRequest,
    options.invite.id,
    options.session.user.id,
    options.requesterDeviceId,
    options.keyPackageId,
    options.keyPackageHash,
    options.sealedRequest
  );
  if (!same) return sendRelayError(options.res, 409, "conflict", "requestId is already bound to another request.");
  if (options.pendingSave && !(await options.pendingSave)) {
    return sendRelayError(options.res, 503, "persistence_unavailable", "Could not persist invite request.");
  }
  options.res.status(200).json({ requestId: options.existingRequest.requestId, status: "pending" });
}

function pendingInviteConflict(store: RelayStore, invite: InviteRecord): string | null {
  const hasPendingRequest = Array.from(store.inviteRequests.values()).some((pending) => pending.inviteId === invite.id);
  if (hasPendingRequest) return "This invite already has a pending request.";
  return inviteHasPendingDecision(store, invite) ? "This invite already has a pending decision." : null;
}

function isActiveInviteHost(
  session: AuthSession | null,
  room: RoomRecord | null | undefined,
  hostDeviceId: string,
  targetIsActive: boolean
): session is AuthSession {
  return Boolean(
    targetIsActive && session && room && room.hostUserId === session.user.id && room.activeHostDeviceId === hostDeviceId
  );
}

function inviteResponsePreconditionError(
  invite: InviteRecord | undefined,
  request: InviteJoinRequestRecord | undefined,
  status: unknown,
  welcome: string | undefined
): { status: number; code: "invalid_request" | "conflict"; message: string } | null {
  if (!request || request.inviteId !== invite?.id) {
    return { status: 400, code: "invalid_request", message: "Invalid invite response." };
  }
  if (status === "approved" && !isApprovedInviteRequest(invite, request)) {
    return { status: 409, code: "conflict", message: "The exact invite request has not been approved." };
  }
  if (status === "approved" && (!welcome || !isCanonicalPaddedBase64(welcome, maxOpaqueChars))) {
    return { status: 400, code: "invalid_request", message: "Approved invite response requires a canonical Welcome." };
  }
  if (status === "denied" && welcome !== undefined) {
    return { status: 400, code: "invalid_request", message: "Denied invite response cannot include a Welcome." };
  }
  return null;
}

function validInviteResponseRecord(
  candidate: unknown,
  invite: InviteRecord,
  request: InviteJoinRequestRecord,
  hostUserId: string,
  room: RoomRecord
): InviteResponseRecordType | null {
  const parsed = InviteResponseRecord.safeParse(candidate);
  if (!parsed.success || !isCanonicalPaddedBase64(parsed.data.responseMac, 128)) return null;
  return inviteResponseBindingMatches(parsed.data, invite, request, hostUserId, room) ? parsed.data : null;
}

function hasExactKeys(value: unknown, allowed: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
