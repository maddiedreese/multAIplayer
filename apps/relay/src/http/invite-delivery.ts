import type { Express, Response } from "express";
import {
  InviteResponseRecord,
  type InviteJoinRequestRecord,
  type InviteResponseRecord as InviteResponseRecordType
} from "@multaiplayer/protocol";
import type { AuthSession, RelayStore } from "../state.js";
import { hasDeviceSession } from "./device-auth.js";
import { isCanonicalPaddedBase64, parseStrictDirectedInviteRequestJson } from "../opaque.js";

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
    if (!session) return void res.status(401).json({ error: "Sign in before requesting to join." });
    const invite = store.getInvite(String(req.params.inviteId ?? ""));
    const requestId = normalizeMetadataText(req.body?.requestId, maxEnvelopeIdChars);
    const requesterDeviceId = normalizeMetadataText(req.body?.requesterDeviceId, maxDeviceIdChars);
    const keyPackageId = normalizeMetadataText(req.body?.keyPackageId, maxEnvelopeIdChars);
    const keyPackageHash = String(req.body?.keyPackageHash ?? "");
    const sealedRequest = String(req.body?.sealedRequest ?? "");
    if (!hasExactKeys(req.body, ["requestId", "requesterDeviceId", "keyPackageId", "keyPackageHash", "sealedRequest"]))
      return void res.status(400).json({ error: "Invite request contains unsupported fields." });
    if (!requestId || !requesterDeviceId || !keyPackageId)
      return void res.status(400).json({ error: "Invalid invite request identifiers." });
    const kp = store.keyPackages.get(keyPackageId);
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, requesterDeviceId))
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    if (!invite) return void res.status(404).json({ error: "Invite not found." });
    const existingRequest = store.inviteRequests.get(requestId);
    if (existingRequest) {
      if (
        existingRequest.inviteId === invite.id &&
        existingRequest.requesterUserId === session.user.id &&
        existingRequest.requesterDeviceId === requesterDeviceId &&
        existingRequest.keyPackageId === keyPackageId &&
        existingRequest.keyPackageHash === keyPackageHash &&
        existingRequest.sealedRequest === sealedRequest
      ) {
        const pendingSave = requestSaves.get(requestId);
        if (pendingSave && !(await pendingSave))
          return void res.status(503).json({ error: "Could not persist invite request." });
        return void res.status(200).json({ requestId, status: "pending" });
      }
      return void res.status(409).json({ error: "requestId is already bound to another request." });
    }
    if (Array.from(store.inviteRequests.values()).some((pending) => pending.inviteId === invite.id)) {
      return void res.status(409).json({ error: "This invite already has a pending request." });
    }
    if (
      Array.from(store.inviteResponses.values()).some((response) => response.inviteId === invite.id) ||
      invite.approvedUserId !== undefined ||
      invite.approvedDeviceId !== undefined ||
      invite.keyPackageHash !== undefined
    ) {
      return void res.status(409).json({ error: "This invite already has a pending decision." });
    }
    const directed = parseStrictDirectedInviteRequestJson(sealedRequest, maxOpaqueChars);
    const room = store.getRoom(invite.roomId);
    if (
      !kp ||
      kp.userId !== session.user.id ||
      kp.deviceId !== requesterDeviceId ||
      kp.keyPackageHash !== keyPackageHash ||
      !directed ||
      directed.binding.inviteId !== invite.id ||
      directed.binding.teamId !== invite.teamId ||
      directed.binding.roomId !== invite.roomId ||
      directed.binding.keyEpoch !== (room?.acceptedMlsEpoch ?? 0) ||
      directed.binding.keyPackageHash !== keyPackageHash ||
      directed.binding.requestId !== requestId ||
      directed.binding.requesterUserId !== session.user.id ||
      directed.binding.requesterDeviceId !== requesterDeviceId ||
      directed.binding.hostUserId !== room?.hostUserId ||
      directed.binding.hostDeviceId !== room?.activeHostDeviceId ||
      directed.binding.expiresAt !== invite.expiresAt
    ) {
      return void res.status(400).json({ error: "Invalid invite request." });
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
    store.inviteRequests.set(requestId, record);
    const saveResult = saveRelayStore().then(
      () => true,
      () => false
    );
    requestSaves.set(requestId, saveResult);
    const persisted = await saveResult;
    if (requestSaves.get(requestId) === saveResult) requestSaves.delete(requestId);
    if (!persisted) {
      store.inviteRequests.delete(requestId);
      return void res.status(503).json({ error: "Could not persist invite request." });
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
      return void res.status(403).json({ error: "Only the active host device may read invite requests." });
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, room.activeHostDeviceId!))
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    res.json({ requests: Array.from(store.inviteRequests.values()).filter((item) => item.inviteId === invite.id) });
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
      return void res.status(400).json({ error: "Invite response contains unsupported fields." });
    if (
      !session ||
      !room ||
      room.hostUserId !== session.user.id ||
      room.activeHostDeviceId !== String(req.body?.hostDeviceId ?? "")
    )
      return void res.status(403).json({ error: "Only the active host device may publish an invite response." });
    if (!hasDeviceSession(store, req.get("x-device-session"), session.user.id, room.activeHostDeviceId!))
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    const existingWelcome = store.inviteResponses.get(String(req.body?.requestId ?? ""));
    if (existingWelcome) {
      if (
        existingWelcome.inviteId === invite?.id &&
        existingWelcome.status === status &&
        existingWelcome.responseMac === req.body?.responseMac &&
        JSON.stringify(existingWelcome.responseBinding) === JSON.stringify(req.body?.responseBinding) &&
        existingWelcome.welcome === welcome
      )
        return void res.status(200).json({ requestId: existingWelcome.requestId, status: "ready" });
      return void res.status(409).json({ error: "requestId is already bound to another invite response." });
    }
    if (!request || request.inviteId !== invite?.id)
      return void res.status(400).json({ error: "Invalid invite response." });
    const approved =
      invite?.approvedUserId === request.requesterUserId &&
      invite.approvedDeviceId === request.requesterDeviceId &&
      invite.keyPackageHash === request.keyPackageHash;
    if (status === "approved" && !approved)
      return void res.status(409).json({ error: "The exact invite request has not been approved." });
    if (status === "approved" && (!welcome || !isCanonicalPaddedBase64(welcome, maxOpaqueChars)))
      return void res.status(400).json({ error: "Approved invite response requires a canonical Welcome." });
    if (status === "denied" && welcome !== undefined)
      return void res.status(400).json({ error: "Denied invite response cannot include a Welcome." });
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
    if (!parsedRecord.success) return void res.status(400).json({ error: "Invalid invite response binding or MAC." });
    const record = parsedRecord.data;
    if (!isCanonicalPaddedBase64(record.responseMac, 128))
      return void res.status(400).json({ error: "Invalid invite response binding or MAC." });
    const binding = record.responseBinding;
    if (
      binding.inviteId !== invite.id ||
      binding.teamId !== invite.teamId ||
      binding.roomId !== invite.roomId ||
      binding.requestId !== request.requestId ||
      binding.keyPackageHash !== request.keyPackageHash ||
      binding.requesterUserId !== request.requesterUserId ||
      binding.requesterDeviceId !== request.requesterDeviceId ||
      binding.hostUserId !== session.user.id ||
      binding.hostDeviceId !== room.activeHostDeviceId ||
      binding.status !== record.status
    )
      return void res.status(400).json({ error: "Invite response binding does not match its request." });
    store.inviteRequests.delete(request.requestId);
    store.inviteResponses.set(record.requestId, record);
    try {
      await saveRelayStore();
    } catch {
      store.inviteResponses.delete(record.requestId);
      store.inviteRequests.set(request.requestId, request);
      return void res.status(503).json({ error: "Could not persist invite response." });
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
      return void res.status(403).json({ error: "A device-authenticated session is required." });
    if (
      !session ||
      !record ||
      record.inviteId !== String(req.params.inviteId) ||
      record.requesterUserId !== session.user.id ||
      record.requesterDeviceId !== String(req.query.requesterDeviceId ?? "")
    )
      return void res.status(404).json({ error: "Welcome not found." });
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
      return void res.status(400).json({ error: "Invite response ACK contains unsupported fields." });
    const requesterDeviceId = String(req.body.requesterDeviceId ?? "");
    const record = store.inviteResponses.get(String(req.params.requestId ?? ""));
    if (!session) return void res.status(404).json({ error: "Invite response not found." });
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
      return void res.status(404).json({ error: "Invite response not found." });
    }
    if (
      record.inviteId !== String(req.params.inviteId) ||
      record.requesterUserId !== session.user.id ||
      record.requesterDeviceId !== requesterDeviceId ||
      !hasDeviceSession(store, req.get("x-device-session"), session.user.id, record.requesterDeviceId)
    )
      return void res.status(404).json({ error: "Invite response not found." });
    const result = await ackInviteResponseAtomically(store, record, saveRelayStore);
    if (result === "missing_team") return void res.status(404).json({ error: "Invite response team not found." });
    if (result === "revoked") return void res.status(409).json({ error: "Invite approval was revoked before ACK." });
    if (result === "persistence_failed") {
      return void res.status(503).json({ error: "Could not acknowledge invite response durably." });
    }
    res.status(204).end();
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
