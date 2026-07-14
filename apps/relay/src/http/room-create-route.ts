import { sendRelayError } from "./errors.js";
import { nanoid } from "nanoid";
import {
  defaultApprovalDelegationPolicy,
  defaultBrowserAllowedOrigins,
  defaultBrowserProfilePersistent,
  defaultCodexModel,
  defaultCodexModelPolicy,
  defaultCodexReasoningEffort,
  defaultCodexReasoningEffortPolicy,
  defaultCodexRawReasoningEnabled,
  defaultCodexSandboxLevel,
  defaultCodexServiceTierPolicy,
  defaultCodexSpeed,
  defaultRoomMode,
  codexReasoningEffortIds,
  type RoomRecord
} from "@multaiplayer/protocol";
import { loadRelayConfig } from "../config.js";
import {
  allowTotalRoomQuota,
  consumeDailyCreationQuota,
  normalizeCatalogSelectionPolicy,
  normalizeCodexSandboxLevel,
  normalizeTrustedApproverUserIds
} from "./room-validation.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

const codexReasoningEffortError = `codexReasoningEffort must be one of ${codexReasoningEffortIds.join(", ")}`;

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
    normalizeRoomProjectPath,
    normalizeCodexModel,
    normalizeCodexReasoningEffort,
    normalizeCodexSpeed,
    normalizeBrowserAllowedOrigins,
    isApprovalPolicy,
    isApprovalDelegationPolicy,
    displayNameForUser,
    maxCodexModelChars,
    maxHostNameChars,
    maxRoomNameChars,
    maxRoomProjectPathChars,
    maxUserIdChars
  } = options;
  const { dailyCreationCaps, totalRoomCapPerUser } = loadRelayConfig();

  app.post("/rooms", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!allowMutation(session, res)) return;
    const teamId = String(req.body?.teamId ?? "");
    const name = normalizeMetadataText(req.body?.name, maxRoomNameChars);
    const projectPath = normalizeRoomProjectPath(req.body?.projectPath);
    const approvalPolicy = req.body?.approvalPolicy === undefined ? "ask_every_turn" : String(req.body.approvalPolicy);
    const approvalDelegationPolicy =
      req.body?.approvalDelegationPolicy === undefined
        ? defaultApprovalDelegationPolicy
        : String(req.body.approvalDelegationPolicy);
    const trustedApproverUserIds = normalizeTrustedApproverUserIds(req.body?.trustedApproverUserIds, maxUserIdChars);
    const codexModel =
      req.body?.codexModel === undefined ? defaultCodexModel : normalizeCodexModel(req.body.codexModel);
    const codexModelPolicy = normalizeCatalogSelectionPolicy(req.body?.codexModelPolicy, defaultCodexModelPolicy);
    const codexReasoningEffort =
      req.body?.codexReasoningEffort === undefined
        ? defaultCodexReasoningEffort
        : normalizeCodexReasoningEffort(req.body.codexReasoningEffort);
    const codexReasoningEffortPolicy = normalizeCatalogSelectionPolicy(
      req.body?.codexReasoningEffortPolicy,
      defaultCodexReasoningEffortPolicy
    );
    const codexRawReasoningEnabled = req.body?.codexRawReasoningEnabled;
    const codexSpeed =
      req.body?.codexSpeed === undefined ? defaultCodexSpeed : normalizeCodexSpeed(req.body.codexSpeed);
    const codexServiceTierPolicy = normalizeCatalogSelectionPolicy(
      req.body?.codexServiceTierPolicy,
      defaultCodexServiceTierPolicy
    );
    const codexSandboxLevel =
      req.body?.codexSandboxLevel === undefined
        ? defaultCodexSandboxLevel
        : normalizeCodexSandboxLevel(req.body.codexSandboxLevel);
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
    if (!projectPath)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `projectPath must be a non-empty string up to ${maxRoomProjectPathChars} characters`
      );
    if (!isApprovalPolicy(approvalPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalPolicy is invalid");
    if (!isApprovalDelegationPolicy(approvalDelegationPolicy))
      return void sendRelayError(res, 400, "invalid_request", "approvalDelegationPolicy is invalid");
    if (trustedApproverUserIds === null)
      return void sendRelayError(res, 400, "invalid_request", "trustedApproverUserIds must be up to 50 user ids");
    if (!codexModel)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        `codexModel must be a known model id or a model-like id up to ${maxCodexModelChars} characters`
      );
    if (!codexModelPolicy || !codexReasoningEffortPolicy || !codexServiceTierPolicy)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "Codex catalog selection policies must be auto or pinned"
      );
    if (!codexReasoningEffort) return void sendRelayError(res, 400, "invalid_request", codexReasoningEffortError);
    if (codexRawReasoningEnabled !== undefined && typeof codexRawReasoningEnabled !== "boolean")
      return void sendRelayError(res, 400, "invalid_request", "codexRawReasoningEnabled must be a boolean");
    if (!codexSpeed) return void sendRelayError(res, 400, "invalid_request", "codexSpeed must be standard or fast");
    if (!codexSandboxLevel)
      return void sendRelayError(
        res,
        400,
        "invalid_request",
        "codexSandboxLevel must be read_only, workspace_write, workspace_write_network, or danger_full_access"
      );
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
      projectPath,
      host: session
        ? (normalizeMetadataText(displayNameForUser(session.user), maxHostNameChars) ?? "Reserved host")
        : "No host",
      hostUserId: session?.user.id,
      hostStatus: "offline",
      approvalPolicy,
      approvalDelegationPolicy,
      trustedApproverUserIds,
      mode: defaultRoomMode,
      codexModel,
      codexModelPolicy,
      codexReasoningEffort,
      codexReasoningEffortPolicy,
      codexRawReasoningEnabled: codexRawReasoningEnabled ?? defaultCodexRawReasoningEnabled,
      codexSpeed,
      codexServiceTierPolicy,
      codexSandboxLevel,
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
