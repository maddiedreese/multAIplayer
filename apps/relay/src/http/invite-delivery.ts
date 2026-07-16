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
import { isActiveInviteTarget, isActiveRoom } from "../relay-domain.js";

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
    const invite = store.getInvite(String(req.params.inviteId));
    const room = invite && store.getRoom(invite.roomId);
    const request = store.inviteRequests.get(String(body.requestId ?? ""));
    const status = body.status;
    const welcome = inviteResponseWelcome(body);
    const expectedKeys = inviteResponseKeys(status);
    if (!hasExactKeys(body, expectedKeys))
      return void sendRelayError(res, 400, "invalid_request", "Invite response contains unsupported fields.");
    if (!isActiveInviteHost(session, room, String(body.hostDeviceId ?? ""), isActiveInviteTarget(store, invite)))
      return void sendRelayError(res, 403, "forbidden", "An active room and host device are required.");
    if (!session || !room || !invite) return;
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, room.activeHostDeviceId!))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    const existingWelcome = store.inviteResponses.get(String(body.requestId ?? ""));
    if (existingWelcome) {
      if (isSameInviteResponse(existingWelcome, invite.id, status, body.responseMac, body.responseBinding, welcome))
        return void res.status(200).json({ requestId: existingWelcome.requestId, status: "ready" });
      return void sendRelayError(res, 409, "conflict", "requestId is already bound to another invite response.");
    }
    const preconditionError = inviteResponsePreconditionError(invite, request, status, welcome);
    if (preconditionError)
      return void sendRelayError(res, preconditionError.status, preconditionError.code, preconditionError.message);
    if (!request) return;
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
    const record = validInviteResponseRecord(candidate, invite, request, session.user.id, room);
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

function isSameInviteResponse(
  existing: InviteResponseRecordType,
  inviteId: string | undefined,
  status: unknown,
  responseMac: unknown,
  responseBinding: unknown,
  welcome: string | undefined
): boolean {
  return (
    existing.inviteId === inviteId &&
    existing.status === status &&
    existing.responseMac === responseMac &&
    JSON.stringify(existing.responseBinding) === JSON.stringify(responseBinding) &&
    existing.welcome === welcome
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
  try {
    await saveRelayStore();
    return true;
  } catch {
    store.inviteResponses.delete(record.requestId);
    store.inviteRequests.set(request.requestId, request);
    return false;
  }
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

function inviteResponseRemainsAuthorized(
  invite: InviteRecord | undefined,
  record: InviteResponseRecordType
): invite is InviteRecord {
  if (!invite) return false;
  const binding = record.responseBinding;
  if (invite.teamId !== binding.teamId || invite.roomId !== binding.roomId) return false;
  if (binding.inviteId !== record.inviteId || binding.requestId !== record.requestId) return false;
  if (binding.requesterUserId !== record.requesterUserId || binding.requesterDeviceId !== record.requesterDeviceId) {
    return false;
  }
  if (binding.keyPackageHash !== record.keyPackageHash || binding.status !== record.status) return false;
  if (record.status !== "approved") return true;
  return (
    invite.approvedUserId === record.requesterUserId &&
    invite.approvedDeviceId === record.requesterDeviceId &&
    invite.keyPackageHash === record.keyPackageHash
  );
}

export async function ackInviteResponseAtomically(
  store: RelayStore,
  record: InviteResponseRecordType,
  saveRelayStore: () => Promise<void>
): Promise<"ok" | "missing_team" | "inactive_target" | "revoked" | "persistence_failed"> {
  const team = store.getTeam(record.responseBinding.teamId);
  if (!team) return "missing_team";
  if (!isActiveRoom(store, record.responseBinding.teamId, record.responseBinding.roomId)) return "inactive_target";
  const previousMembers = new Map(store.getTeamMembers(team.id) ?? []);
  const invite = store.getInvite(record.inviteId);
  if (!inviteResponseRemainsAuthorized(invite, record)) return "revoked";
  const previousReceipts = new Map(store.inviteAckReceipts);
  if (record.status === "approved") {
    const members = new Map(previousMembers);
    if (!members.has(record.requesterUserId)) {
      members.set(record.requesterUserId, {
        teamId: team.id,
        userId: record.requesterUserId,
        role: "member",
        joinedAt: new Date().toISOString()
      });
    }
    store.setTeamMembers(team.id, members);
    store.setTeam({ ...team, members: members.size });
  }
  store.deleteInvite(record.inviteId);
  store.inviteResponses.delete(record.requestId);
  store.inviteAckReceipts.set(record.requestId, {
    inviteId: record.inviteId,
    requestId: record.requestId,
    teamId: team.id,
    requesterUserId: record.requesterUserId,
    requesterDeviceId: record.requesterDeviceId,
    keyPackageHash: record.keyPackageHash,
    status: record.status,
    acknowledgedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  pruneInviteAckReceipts(store);
  try {
    await saveRelayStore();
    return "ok";
  } catch {
    store.inviteResponses.set(record.requestId, record);
    store.setTeamMembers(team.id, previousMembers);
    store.setTeam(team);
    if (invite) store.setInvite(invite);
    store.inviteAckReceipts.clear();
    for (const [id, receipt] of previousReceipts) store.inviteAckReceipts.set(id, receipt);
    return "persistence_failed";
  }
}

function pruneInviteAckReceipts(store: RelayStore) {
  const now = Date.now();
  const ordered = Array.from(store.inviteAckReceipts.entries()).sort(
    (left, right) => Date.parse(left[1].acknowledgedAt) - Date.parse(right[1].acknowledgedAt)
  );
  for (const [id, receipt] of ordered) if (Date.parse(receipt.expiresAt) <= now) store.inviteAckReceipts.delete(id);
  const retained = ordered.filter(([id]) => store.inviteAckReceipts.has(id));
  for (const [id] of retained.slice(0, Math.max(0, retained.length - 4096))) store.inviteAckReceipts.delete(id);
}

function hasExactKeys(value: unknown, allowed: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}
