import { sendRelayCapacityError, sendRelayError } from "./errors.js";
import { nanoid } from "nanoid";
import type { RoomRecord } from "@multaiplayer/protocol";
import { allowTotalRoomQuota } from "./room-validation.js";
import {
  acquireDurableQuotaTransaction,
  nextUtcMidnight,
  reserveDurableQuota,
  rollbackDurableQuota
} from "../auth/account-quotas.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";
import type { Response } from "express";
import { RelayStoreCapacityError } from "../state.js";
import { acquireAccountMutationTurn, isLiveAccountSession } from "../auth/account-mutation-transaction.js";

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
  const { app, getAuthSession, allowMutation } = options;

  app.post("/rooms", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const teamId = String(req.body?.teamId ?? "");
    if (!allowRoomCreation(options, session, teamId, res)) return;
    const input = parseRoomCreationInput(options, req.body, res);
    if (!input) return;
    await persistRoomCreation(options, session, teamId, input, res);
  });
}

async function persistRoomCreation(
  options: RegisterRoomRoutesOptions,
  session: ReturnType<RegisterRoomRoutesOptions["getAuthSession"]>,
  teamId: string,
  input: NonNullable<ReturnType<typeof parseRoomCreationInput>>,
  res: Response
) {
  const releaseAccountMutation = session ? await acquireAccountMutationTurn(options.store, session.user.id) : null;
  try {
    if (!allowQueuedRoomCreation(options, session, teamId, res)) return;
    await persistRoomWithinQuotaTransaction(options, session, teamId, input, res);
  } finally {
    releaseAccountMutation?.();
  }
}

async function persistRoomWithinQuotaTransaction(
  options: RegisterRoomRoutesOptions,
  session: ReturnType<RegisterRoomRoutesOptions["getAuthSession"]>,
  teamId: string,
  input: NonNullable<ReturnType<typeof parseRoomCreationInput>>,
  res: Response
): Promise<void> {
  const dailyCreationCaps = options.dailyCreationCaps ?? { roomsPerUser: 100 };
  const releaseQuotaTransaction = await acquireDurableQuotaTransaction(options.store);
  let reservation: ReturnType<typeof reserveDurableQuota> | null = null;
  let room: RoomRecord | null = null;
  let durableCommitCompleted = false;
  try {
    reservation = session
      ? reserveDurableQuota({
          store: options.store,
          quota: "daily_room_creations",
          userId: session.user.id,
          limit: dailyCreationCaps.roomsPerUser,
          resetAt: nextUtcMidnight()
        })
      : null;
    if (reservation && !reservation.allowed) {
      options.recordQuotaRejection?.("daily_user_room_creations");
      const retryAfterSeconds = Math.max(1, Math.ceil((reservation.resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds);
      sendRelayError(res, 429, "quota_exceeded", "Daily room creation quota exceeded.", {
        retryAfterSeconds,
        quota: {
          type: "daily_user_room_creations",
          limit: dailyCreationCaps.roomsPerUser,
          used: reservation.used,
          remaining: 0,
          resetsAt: new Date(reservation.resetAt).toISOString()
        }
      });
      return;
    }
    room = {
      id: `room_${nanoid(10)}`,
      teamId,
      name: input.name,
      host: session
        ? (options.normalizeMetadataText(options.displayNameForUser(session.user), options.maxHostNameChars) ??
          "Reserved host")
        : "No host",
      hostUserId: session?.user.id,
      hostStatus: "offline",
      approvalPolicy: input.approvalPolicy
    };
    options.store.setRoom(room);
    if (session) await options.saveRelayStore();
    else options.scheduleStoreSave();
    durableCommitCompleted = true;
    options.broadcastRoomUpdated(room);
    res.status(201).json({ room });
  } catch (error) {
    if (durableCommitCompleted) throw error;
    rollbackRoomCreation(options.store, room, reservation);
    if (error instanceof RelayStoreCapacityError) {
      options.recordCapacityRejection?.("durable_entries", error.teamId ? "team" : "relay");
      sendRelayCapacityError(res, error);
      return;
    }
    sendRelayError(res, 503, "persistence_unavailable", "Could not persist room quota and room.");
  } finally {
    releaseQuotaTransaction();
  }
}

function allowQueuedRoomCreation(
  options: RegisterRoomRoutesOptions,
  session: ReturnType<RegisterRoomRoutesOptions["getAuthSession"]>,
  teamId: string,
  res: Response
) {
  if (session && !isLiveAccountSession(options.store, session)) {
    sendRelayError(res, 401, "authentication_required", "Sign in before creating a room.");
    return false;
  }
  if (!allowRoomCreation(options, session, teamId, res)) return false;
  if (!session) return true;
  return allowTotalRoomQuota({
    store: options.store,
    teamIds: options.teamIdsForUser(session.user.id),
    cap: options.totalRoomCapPerUser ?? 500,
    res,
    recordQuotaRejection: options.recordQuotaRejection
  });
}

function rollbackRoomCreation(
  store: RegisterRoomRoutesOptions["store"],
  room: RoomRecord | null,
  reservation: ReturnType<typeof reserveDurableQuota> | null
) {
  if (room) store.rooms.delete(room.id);
  if (reservation?.allowed) rollbackDurableQuota(store, reservation);
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
  const approvalPolicy = record.approvalPolicy === undefined ? "ask_every_turn" : String(record.approvalPolicy);
  if (!options.isApprovalPolicy(approvalPolicy)) return sendInvalidRoomField(res, "approvalPolicy is invalid");
  return { name, approvalPolicy };
}

function sendInvalidRoomField(res: Response, message: string): null {
  sendRelayError(res, 400, "invalid_request", message);
  return null;
}
