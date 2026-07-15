import { sendRelayError } from "./errors.js";
import { nanoid } from "nanoid";
import {
  defaultApprovalDelegationPolicy,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultRoomMode,
  type RoomRecord
} from "@multaiplayer/protocol";
import { loadRelayConfig } from "../config.js";
import { allowTotalRoomQuota, normalizeTrustedApproverUserIds } from "./room-validation.js";
import {
  acquireDurableQuotaTransaction,
  nextUtcMidnight,
  reserveDurableQuota,
  rollbackDurableQuota
} from "../auth/account-quotas.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";
import type { Response } from "express";

const encryptedConfigFields = [
  "projectPath",
  "codexModel",
  "codexModelPolicy",
  "codexReasoningEffort",
  "codexReasoningEffortPolicy",
  "codexRawReasoningEnabled",
  "codexSpeed",
  "codexServiceTierPolicy",
  "codexSandboxLevel"
] as const;

export function registerRoomCreateRoute(options: RegisterRoomRoutesOptions) {
  const {
    app,
    store,
    getAuthSession,
    allowMutation,
    teamIdsForUser,
    scheduleStoreSave,
    saveRelayStore,
    broadcastRoomUpdated,
    recordQuotaRejection,
    normalizeMetadataText,
    displayNameForUser,
    maxHostNameChars
  } = options;
  const { dailyCreationCaps, totalRoomCapPerUser } = loadRelayConfig();

  app.post("/rooms", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const teamId = String(req.body?.teamId ?? "");
    if (!allowRoomCreation(options, session, teamId, res)) return;
    const input = parseRoomCreationInput(options, req.body, res);
    if (!input) return;
    if (
      session &&
      !allowTotalRoomQuota({
        store,
        teamIds: teamIdsForUser(session.user.id),
        cap: totalRoomCapPerUser,
        res,
        recordQuotaRejection
      })
    )
      return;
    const releaseQuotaTransaction = await acquireDurableQuotaTransaction(store);
    try {
      const reservation = session
        ? reserveDurableQuota({
            store,
            quota: "daily_room_creations",
            userId: session.user.id,
            limit: dailyCreationCaps.roomsPerUser,
            resetAt: nextUtcMidnight()
          })
        : null;
      if (reservation && !reservation.allowed) {
        recordQuotaRejection?.("daily_user_room_creations");
        res.setHeader("Retry-After", Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000)));
        return void sendRelayError(res, 429, "quota_exceeded", "Daily room creation quota exceeded.", {
          retryAfterSeconds: Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000)),
          quota: {
            type: "daily_user_room_creations",
            limit: dailyCreationCaps.roomsPerUser,
            used: reservation.used,
            remaining: 0,
            resetsAt: new Date(reservation.resetAt).toISOString()
          }
        });
      }
      const room: RoomRecord = {
        id: `room_${nanoid(10)}`,
        teamId,
        name: input.name,
        host: session
          ? (normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? "Reserved host")
          : "No host",
        hostUserId: session?.user.id,
        hostStatus: "offline",
        approvalPolicy: input.approvalPolicy,
        approvalDelegationPolicy: input.approvalDelegationPolicy,
        trustedApproverUserIds: input.trustedApproverUserIds,
        mode: defaultRoomMode,
        browserAllowedOrigins: input.browserAllowedOrigins,
        browserProfilePersistent: input.browserProfilePersistent,
        unread: 0
      };
      store.setRoom(room);
      try {
        if (session) await saveRelayStore();
        else scheduleStoreSave();
      } catch {
        store.rooms.delete(room.id);
        if (reservation?.allowed) rollbackDurableQuota(store, reservation);
        return void sendRelayError(res, 503, "persistence_unavailable", "Could not persist room quota and room.");
      }
      broadcastRoomUpdated(room);
      res.status(201).json({ room });
    } finally {
      releaseQuotaTransaction();
    }
  });
}

function allowRoomCreation(
  { store, isTeamMember }: RegisterRoomRoutesOptions,
  session: ReturnType<RegisterRoomRoutesOptions["getAuthSession"]>,
  teamId: string,
  res: Response
) {
  if (!store.hasTeam(teamId)) {
    sendRelayError(res, 404, "team_not_found", "Team not found");
    return false;
  }
  const team = store.getTeam(teamId);
  if (team?.archivedAt || team?.deletedAt) {
    sendRelayError(res, 409, "conflict", "Restore this team before creating rooms.");
    return false;
  }
  if (session && !isTeamMember(teamId, session.user.id)) {
    sendRelayError(res, 403, "forbidden", "Join this team before creating rooms.");
    return false;
  }
  return true;
}

function parseRoomCreationInput(options: RegisterRoomRoutesOptions, body: unknown, res: Response) {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (encryptedConfigFields.some((field) => Object.prototype.hasOwnProperty.call(record, field))) {
    sendRelayError(res, 400, "invalid_request", "Host-local room configuration must be published through MLS.");
    return null;
  }
  const name = options.normalizeMetadataText(record.name, options.maxRoomNameChars);
  if (!name) {
    sendRelayError(
      res,
      400,
      "invalid_request",
      `Room name is required and must be up to ${options.maxRoomNameChars} characters`
    );
    return null;
  }
  const policies = parseRoomPolicies(options, record, res);
  if (!policies) return null;
  const browser = parseBrowserPreferences(options, record, res);
  return browser ? { name, ...policies, ...browser } : null;
}

function parseRoomPolicies(options: RegisterRoomRoutesOptions, record: Record<string, unknown>, res: Response) {
  const approvalPolicy = record.approvalPolicy === undefined ? "ask_every_turn" : String(record.approvalPolicy);
  const approvalDelegationPolicy =
    record.approvalDelegationPolicy === undefined
      ? defaultApprovalDelegationPolicy
      : String(record.approvalDelegationPolicy);
  const trustedApproverUserIds = normalizeTrustedApproverUserIds(record.trustedApproverUserIds, options.maxUserIdChars);
  if (!options.isApprovalPolicy(approvalPolicy)) return sendInvalidRoomField(res, "approvalPolicy is invalid");
  if (!options.isApprovalDelegationPolicy(approvalDelegationPolicy))
    return sendInvalidRoomField(res, "approvalDelegationPolicy is invalid");
  if (trustedApproverUserIds === null)
    return sendInvalidRoomField(res, "trustedApproverUserIds must be up to 50 user ids");
  return { approvalPolicy, approvalDelegationPolicy, trustedApproverUserIds };
}

function parseBrowserPreferences(options: RegisterRoomRoutesOptions, record: Record<string, unknown>, res: Response) {
  let browserAllowedOrigins = defaultBrowserAllowedOrigins;
  if (record.browserAllowedOrigins !== undefined) {
    const parsed = options.normalizeBrowserAllowedOrigins(record.browserAllowedOrigins);
    if (parsed === null)
      return sendInvalidRoomField(
        res,
        "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com"
      );
    browserAllowedOrigins = parsed;
  }
  if (record.browserProfilePersistent !== undefined && typeof record.browserProfilePersistent !== "boolean")
    return sendInvalidRoomField(res, "browserProfilePersistent must be a boolean");
  return {
    browserAllowedOrigins,
    browserProfilePersistent: record.browserProfilePersistent ?? defaultBrowserProfilePersistent
  };
}

function sendInvalidRoomField(res: Response, message: string): null {
  sendRelayError(res, 400, "invalid_request", message);
  return null;
}
