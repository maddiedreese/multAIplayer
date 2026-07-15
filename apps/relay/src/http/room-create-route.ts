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
import { allowTotalRoomQuota, consumeDailyCreationQuota, normalizeTrustedApproverUserIds } from "./room-validation.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

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
    isTeamMember,
    scheduleStoreSave,
    broadcastRoomUpdated,
    recordQuotaRejection,
    normalizeMetadataText,
    normalizeBrowserAllowedOrigins,
    isApprovalPolicy,
    isApprovalDelegationPolicy,
    displayNameForUser,
    maxHostNameChars,
    maxRoomNameChars,
    maxUserIdChars
  } = options;
  const { dailyCreationCaps, totalRoomCapPerUser } = loadRelayConfig();

  app.post("/rooms", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const teamId = String(req.body?.teamId ?? "");
    const name = normalizeMetadataText(req.body?.name, maxRoomNameChars);
    if (encryptedConfigFields.some((field) => Object.prototype.hasOwnProperty.call(req.body ?? {}, field)))
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Host-local room configuration must be published through MLS."
      );
    const approvalPolicy = req.body?.approvalPolicy === undefined ? "ask_every_turn" : String(req.body.approvalPolicy);
    const approvalDelegationPolicy =
      req.body?.approvalDelegationPolicy === undefined
        ? defaultApprovalDelegationPolicy
        : String(req.body.approvalDelegationPolicy);
    const trustedApproverUserIds = normalizeTrustedApproverUserIds(req.body?.trustedApproverUserIds, maxUserIdChars);
    const browserAllowedOrigins = req.body?.browserAllowedOrigins;
    const browserProfilePersistent = req.body?.browserProfilePersistent;
    if (!store.hasTeam(teamId)) return void sendRelayError(res, 404, "team_not_found", "Team not found");
    const team = store.getTeam(teamId);
    if (team?.archivedAt || team?.deletedAt)
      return void sendRelayError(res, 409, "conflict", "Restore this team before creating rooms.");
    if (session && !isTeamMember(teamId, session.user.id))
      return void sendRelayError(res, 403, "forbidden", "Join this team before creating rooms.");
    if (!name)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `Room name is required and must be up to ${maxRoomNameChars} characters`
      );
    if (!isApprovalPolicy(approvalPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalPolicy is invalid");
    if (!isApprovalDelegationPolicy(approvalDelegationPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalDelegationPolicy is invalid");
    if (trustedApproverUserIds === null)
      return void sendRelayError(res, 400, "invalid_request", "trustedApproverUserIds must be up to 50 user ids");
    let normalizedBrowserAllowedOrigins = defaultBrowserAllowedOrigins;
    if (browserAllowedOrigins !== undefined) {
      const parsed = normalizeBrowserAllowedOrigins(browserAllowedOrigins);
      if (parsed === null)
        return void sendRelayError(
          res,
          400,
          "invalid_request",
          "browserAllowedOrigins must be up to 20 http(s) origins such as https://github.com"
        );
      normalizedBrowserAllowedOrigins = parsed;
    }
    if (browserProfilePersistent !== undefined && typeof browserProfilePersistent !== "boolean")
      return void sendRelayError(res, 400, "invalid_request", "browserProfilePersistent must be a boolean");
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
    if (
      session &&
      !consumeDailyCreationQuota({
        cap: dailyCreationCaps.roomsPerUser,
        counts: store.dailyRoomCreationCounts,
        quota: "daily_user_room_creations",
        userId: session.user.id,
        res,
        recordQuotaRejection
      })
    )
      return;
    const room: RoomRecord = {
      id: `room_${nanoid(10)}`,
      teamId,
      name,
      host: session
        ? (normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? "Reserved host")
        : "No host",
      hostUserId: session?.user.id,
      hostStatus: "offline",
      approvalPolicy,
      approvalDelegationPolicy,
      trustedApproverUserIds,
      mode: defaultRoomMode,
      browserAllowedOrigins: normalizedBrowserAllowedOrigins,
      browserProfilePersistent: browserProfilePersistent ?? defaultBrowserProfilePersistent,
      unread: 0
    };
    store.setRoom(room);
    scheduleStoreSave();
    broadcastRoomUpdated(room);
    res.status(201).json({ room });
  });
}
