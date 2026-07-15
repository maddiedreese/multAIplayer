import { sendRelayError } from "../http/errors.js";
import type { CookieOptions, Express } from "express";
import { nanoid } from "nanoid";
import type { AuthSession, NewAuthSession } from "../state.js";
import { fetchUpstream } from "../http/upstream.js";
import {
  accountDeletionConfirmation,
  deleteAccountOwnedRelayDataAtomically,
  findAccountDeletionBlockers
} from "./account-deletion.js";
import type { RelayStore } from "../state.js";
import type { DeletionLedger } from "./deletion-ledger.js";

export interface RegisterGitHubAuthRoutesOptions {
  app: Express;
  mutationsRequireAuth: boolean;
  allowedCorsOrigins: string[];
  setAuthSession: (sessionId: string, session: NewAuthSession) => void;
  deleteAuthSession: (sessionId: unknown) => boolean;
  store: RelayStore;
  deletionLedger: DeletionLedger | null;
  authSessionMaxAgeMs: number;
  authCookieOptions: (maxAge?: number) => CookieOptions;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  scheduleStoreSave: () => void;
  saveRelayStore: () => Promise<void>;
  revokeTeamMemberSessions: (teamId: string, userId: string) => void;
  revokeUserPresence: (userId: string) => void;
  normalizeMetadataText: (value: unknown, maxChars: number) => string | null;
  maxUserIdChars: number;
  maxDisplayNameChars: number;
  maxRoomProjectPathChars: number;
  maxAccessTokenChars: number;
  isAccountRestricted: (userId: string) => boolean;
}

export function registerGitHubAuthRoutes({
  app,
  mutationsRequireAuth,
  allowedCorsOrigins,
  setAuthSession,
  deleteAuthSession,
  store,
  deletionLedger,
  authSessionMaxAgeMs,
  authCookieOptions,
  getAuthSession,
  scheduleStoreSave,
  saveRelayStore,
  revokeTeamMemberSessions,
  revokeUserPresence,
  normalizeMetadataText,
  maxUserIdChars,
  maxDisplayNameChars,
  maxRoomProjectPathChars,
  maxAccessTokenChars,
  isAccountRestricted
}: RegisterGitHubAuthRoutesOptions) {
  app.get("/auth/config", (_req, res) => {
    res.json({
      provider: "github",
      configured: true,
      scopes: ["read:user", "repo"],
      mutationsRequireAuth,
      allowedOrigins: allowedCorsOrigins,
      sessionPersistence: "identity_only",
      accountDeletion: deletionLedger ? "external_ledger_protected" : "unavailable"
    });
  });

  app.post("/auth/github/verify", async (req, res) => {
    const accessToken = normalizeMetadataText(req.body?.access_token, maxAccessTokenChars);
    if (!accessToken) {
      sendRelayError(res, 400, "invalid_request", "access_token must be a bounded non-empty string");
      return;
    }

    const userResponse = await fetchUpstream("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "multAIplayer-alpha"
      }
    });
    if (!userResponse.ok) {
      sendRelayError(res, userResponse.status, "upstream_unavailable", "Failed to load GitHub user");
      return;
    }
    const githubUser = (await userResponse.json()) as {
      id: number;
      login: string;
      name?: string | null;
      avatar_url?: string;
    };
    const userId = Number.isSafeInteger(githubUser.id) ? `github:${githubUser.id}` : null;
    const normalizedUserId = normalizeMetadataText(userId, maxUserIdChars);
    const login = normalizeMetadataText(githubUser.login, maxDisplayNameChars);
    const name = githubUser.name ? normalizeMetadataText(githubUser.name, maxDisplayNameChars) : null;
    const avatarUrl = githubUser.avatar_url
      ? normalizeMetadataText(githubUser.avatar_url, maxRoomProjectPathChars)
      : null;
    if (!normalizedUserId || !login || (githubUser.name && !name) || (githubUser.avatar_url && !avatarUrl)) {
      sendRelayError(res, 502, "upstream_unavailable", "GitHub returned unsupported user metadata");
      return;
    }
    if (isAccountRestricted(normalizedUserId)) {
      sendRelayError(res, 403, "account_restricted", "This account is restricted by the relay operator.");
      return;
    }
    if (deletionLedger) {
      let deletedSubjects;
      try {
        deletedSubjects = new Set((await deletionLedger.list()).map((entry) => entry.subject));
      } catch {
        sendRelayError(
          res,
          503,
          "persistence_unavailable",
          "GitHub sign-in is temporarily unavailable because deletion safety could not be verified."
        );
        return;
      }
      if (deletedSubjects.has(deletionLedger.subjectFor(normalizedUserId))) {
        sendRelayError(
          res,
          403,
          "forbidden",
          "This GitHub identity was deleted from the hosted alpha and cannot sign in while protected backups remain."
        );
        return;
      }
    }

    const sessionId = nanoid(32);
    const session: NewAuthSession = {
      user: {
        id: normalizedUserId,
        login,
        ...(name ? { name } : {}),
        ...(avatarUrl ? { avatarUrl } : {})
      },
      expiresAt: Date.now() + authSessionMaxAgeMs
    };
    setAuthSession(sessionId, session);
    scheduleStoreSave();
    res.cookie("multaiplayer_session", sessionId, authCookieOptions(authSessionMaxAgeMs));
    res.json({ user: session.user });
  });

  app.get("/auth/me", (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Not signed in");
      return;
    }
    res.json({ user: session.user });
  });

  app.post("/auth/logout", (req, res) => {
    const sessionId = req.cookies?.multaiplayer_session;
    if (sessionId) {
      deleteAuthSession(sessionId);
      scheduleStoreSave();
    }
    res.clearCookie("multaiplayer_session", authCookieOptions());
    res.json({ ok: true });
  });

  app.delete("/auth/account", async (req, res) => {
    const session = getAuthSession(req.cookies?.multaiplayer_session);
    if (!session) {
      sendRelayError(res, 401, "authentication_required", "Sign in before deleting hosted account data.");
      return;
    }
    if (req.body?.confirmation !== accountDeletionConfirmation) {
      sendRelayError(res, 400, "invalid_request", `confirmation must equal \"${accountDeletionConfirmation}\"`);
      return;
    }

    const userId = session.user.id;
    const blockers = findAccountDeletionBlockers(store, userId);
    if (blockers.ownedTeams.length > 0 || blockers.hostedRooms.length > 0) {
      sendRelayError(
        res,
        409,
        "account_deletion_blocked",
        "Transfer or delete every owned team and hand off every hosted room before deleting your hosted data.",
        { blockers }
      );
      return;
    }

    const memberTeamIds = Array.from(store.teamMembers.entries())
      .filter(([, members]) => members.has(userId))
      .map(([teamId]) => teamId);
    if (!deletionLedger) {
      sendRelayError(
        res,
        503,
        "persistence_unavailable",
        "Hosted account deletion is unavailable until the operator configures its external deletion ledger."
      );
      return;
    }
    let ledgerEntry;
    try {
      ledgerEntry = await deletionLedger.record(userId);
    } catch {
      sendRelayError(
        res,
        503,
        "persistence_unavailable",
        "Hosted account deletion was not started because its external deletion record could not be committed."
      );
      return;
    }
    let deleted;
    try {
      deleted = await deleteAccountOwnedRelayDataAtomically(store, userId, saveRelayStore, [ledgerEntry.id]);
    } catch {
      for (const teamId of memberTeamIds) revokeTeamMemberSessions(teamId, userId);
      revokeUserPresence(userId);
      for (const client of store.sessions.values()) {
        if (client.authSession?.user.id === userId || client.userId === userId) {
          client.socket.close(1008, "Hosted account deletion pending");
        }
      }
      res.clearCookie("multaiplayer_session", authCookieOptions());
      res.status(202).json({
        ok: true,
        status: "pending",
        deleted: null,
        retainedSharedData: [
          "team_and_room_records",
          "mls_ciphertext_and_routing_metadata",
          "encrypted_attachment_blobs",
          "accepted_message_receipts"
        ]
      });
      return;
    }
    for (const teamId of memberTeamIds) revokeTeamMemberSessions(teamId, userId);
    revokeUserPresence(userId);
    for (const client of store.sessions.values()) {
      if (client.authSession?.user.id === userId || client.userId === userId) {
        client.socket.close(1008, "Hosted account data deleted");
      }
    }
    res.clearCookie("multaiplayer_session", authCookieOptions());
    res.json({
      ok: true,
      deleted,
      retainedSharedData: [
        "team_and_room_records",
        "mls_ciphertext_and_routing_metadata",
        "encrypted_attachment_blobs",
        "accepted_message_receipts"
      ]
    });
  });
}
