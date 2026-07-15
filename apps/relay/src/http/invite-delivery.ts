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
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    if (!session) return void sendRelayError(res, 401, "authentication_required", "Sign in before requesting to join.");
    const invite = store.getInvite(String(req.params.inviteId ?? ""));
    const requestId = normalizeMetadataText(req.body?.requestId, maxEnvelopeIdChars);
    const requesterDeviceId = normalizeMetadataText(req.body?.requesterDeviceId, maxDeviceIdChars);
    const keyPackageId = normalizeMetadataText(req.body?.keyPackageId, maxEnvelopeIdChars);
    const keyPackageHash = String(req.body?.keyPackageHash ?? "");
    const sealedRequest = String(req.body?.sealedRequest ?? "");
    if (!hasExactKeys(req.body, ["requestId", "requesterDeviceId", "keyPackageId", "keyPackageHash", "sealedRequest"]))
      return void sendRelayError(res, 400, "invalid_request", "Invite request contains unsupported fields.");
    if (!requestId || !requesterDeviceId || !keyPackageId)
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite request identifiers.");
    const kp = store.keyPackages.get(keyPackageId);
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, requesterDeviceId))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (!invite) return void sendRelayError(res, 404, "invite_not_found", "Invite not found.");
    const existingRequest = store.inviteRequests.get(requestId);
    if (existingRequest) {
      if (
        isSameInviteRequest(
          existingRequest,
          invite.id,
          session.user.id,
          requesterDeviceId,
          keyPackageId,
          keyPackageHash,
          sealedRequest
        )
      ) {
        const pendingSave = requestSaves.get(requestId);
        if (pendingSave && !(await pendingSave))
          return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist invite request.");
        return void res.status(200).json({ requestId, status: "pending" });
      }
      return void sendRelayError(res, 409, "conflict", "requestId is already bound to another request.");
    }
    if (Array.from(store.inviteRequests.values()).some((pending) => pending.inviteId === invite.id)) {
      return void sendRelayError(res, 409, "conflict", "This invite already has a pending request.");
    }
    if (inviteHasPendingDecision(store, invite)) {
      return void sendRelayError(res, 409, "conflict", "This invite already has a pending decision.");
    }
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
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const invite = store.getInvite(String(req.params.inviteId ?? ""));
    const room = invite && store.getRoom(invite.roomId);
    const request = store.inviteRequests.get(String(req.body?.requestId ?? ""));
    const status = req.body?.status;
    const welcome = typeof req.body?.welcome === "string" ? req.body.welcome : undefined;
    const expectedKeys =
      status === "approved"
        ? ["hostDeviceId", "requestId", "status", "responseBinding", "responseMac", "welcome"]
        : ["hostDeviceId", "requestId", "status", "responseBinding", "responseMac"];
    if (!hasExactKeys(req.body, expectedKeys))
      return void sendRelayError(res, 400, "invalid_request", "Invite response contains unsupported fields.");
    if (
      !session ||
      !room ||
      room.hostUserId !== session.user.id ||
      room.activeHostDeviceId !== String(req.body?.hostDeviceId ?? "")
    )
      return void sendRelayError(res, 403, "forbidden", "Only the active host device may publish an invite response.");
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, room.activeHostDeviceId!))
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    const existingWelcome = store.inviteResponses.get(String(req.body?.requestId ?? ""));
    if (existingWelcome) {
      if (
        isSameInviteResponse(
          existingWelcome,
          invite?.id,
          status,
          req.body?.responseMac,
          req.body?.responseBinding,
          welcome
        )
      )
        return void res.status(200).json({ requestId: existingWelcome.requestId, status: "ready" });
      return void sendRelayError(res, 409, "conflict", "requestId is already bound to another invite response.");
    }
    if (!request || request.inviteId !== invite?.id)
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite response.");
    if (status === "approved" && !isApprovedInviteRequest(invite, request))
      return void sendRelayError(res, 409, "conflict", "The exact invite request has not been approved.");
    if (status === "approved" && (!welcome || !isCanonicalPaddedBase64(welcome, maxOpaqueChars)))
      return void sendRelayError(res, 400, "invalid_request", "Approved invite response requires a canonical Welcome.");
    if (status === "denied" && welcome !== undefined)
      return void sendRelayError(res, 400, "invalid_request", "Denied invite response cannot include a Welcome.");
    const candidate = {
      requestId: request.requestId,
      inviteId: request.inviteId,
      requesterUserId: request.requesterUserId,
      requesterDeviceId: request.requesterDeviceId,
      keyPackageHash: request.keyPackageHash,
      status,
      responseBinding: req.body?.responseBinding,
      responseMac: req.body?.responseMac,
      welcome,
      createdAt: new Date().toISOString()
    };
    const parsedRecord = InviteResponseRecord.safeParse(candidate);
    if (!parsedRecord.success)
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite response binding or MAC.");
    const record = parsedRecord.data;
    if (!isCanonicalPaddedBase64(record.responseMac, 128))
      return void sendRelayError(res, 400, "invalid_request", "Invalid invite response binding or MAC.");
    if (!inviteResponseBindingMatches(record, invite, request, session.user.id, room))
      return void sendRelayError(res, 400, "invalid_request", "Invite response binding does not match its request.");
    if (!(await saveInviteResponseAtomically(store, request, record, saveRelayStore))) {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist invite response.");
    }
    res.status(201).json({ requestId: record.requestId, status: "ready" });
  });

  app.get("/invites/:inviteId/response/:requestId", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowRead(session, res)) return;
    const record = store.inviteResponses.get(String(req.params.requestId ?? ""));
    if (
      session &&
      record &&
      !hasDeviceSession(store, req.get("x-device-session"), session.user.id, record.requesterDeviceId)
    )
      return void sendRelayError(res, 403, "device_auth_required", "A device-authenticated session is required.");
    if (
      !session ||
      !record ||
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
    if (result === "persistence_failed") {
      return void sendRelayError(res, 503, "persistence_unavailable", "Could not acknowledge invite response durably.");
    }
    res.status(204).end();
  });
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
  return (
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

export async function ackInviteResponseAtomically(
  store: RelayStore,
  record: InviteResponseRecordType,
  saveRelayStore: () => Promise<void>
): Promise<"ok" | "missing_team" | "revoked" | "persistence_failed"> {
  const team = store.getTeam(record.responseBinding.teamId);
  if (!team) return "missing_team";
  const previousMembers = new Map(store.getTeamMembers(team.id) ?? []);
  const invite = store.getInvite(record.inviteId);
  const binding = record.responseBinding;
  if (
    !invite ||
    invite.teamId !== binding.teamId ||
    invite.roomId !== binding.roomId ||
    binding.inviteId !== record.inviteId ||
    binding.requestId !== record.requestId ||
    binding.requesterUserId !== record.requesterUserId ||
    binding.requesterDeviceId !== record.requesterDeviceId ||
    binding.keyPackageHash !== record.keyPackageHash ||
    binding.status !== record.status ||
    (record.status === "approved" &&
      (invite.approvedUserId !== record.requesterUserId ||
        invite.approvedDeviceId !== record.requesterDeviceId ||
        invite.keyPackageHash !== record.keyPackageHash))
  )
    return "revoked";
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
