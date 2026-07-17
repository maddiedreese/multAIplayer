import { sendRelayCapacityError, sendRelayError } from "../http/errors.js";
import type { CookieOptions, Express, Response } from "express";
import { nanoid } from "nanoid";
import { RelayStoreCapacityError, type AuthSession, type NewAuthSession } from "../state.js";
import { fetchUpstream } from "../http/upstream.js";
import {
  accountDeletionConfirmation,
  deleteAccountOwnedRelayDataWithinTurnAtomically,
  findAccountDeletionBlockers
} from "./account-deletion.js";
import { acquireAccountMutationTurn, isLiveAccountSession } from "./account-mutation-transaction.js";
import type { RelayStore } from "../state.js";
import type { DeletionLedger } from "./deletion-ledger.js";
import { hashAuthSessionId, selectAuthSessionsToEvict } from "./session.js";

export interface RegisterGitHubAuthRoutesOptions {
  app: Express;
  mutationsRequireAuth: boolean;
  allowedCorsOrigins: string[];
  setAuthSession: (sessionId: string, session: NewAuthSession) => void;
  deleteAuthSession: (sessionId: unknown) => boolean;
  store: RelayStore;
  deletionLedger: DeletionLedger | null;
  authSessionMaxAgeMs: number;
  retainedAuthSessionCapPerUser: number;
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
  retainedAuthSessionCapPerUser,
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
  async function recordDeletionProtection(userId: string): Promise<string[] | null> {
    if (!deletionLedger) return [];
    try {
      return [(await deletionLedger.record(userId)).id];
    } catch {
      return null;
    }
  }

  async function issueVerifiedSession(user: NewAuthSession["user"], res: Response): Promise<void> {
    const releaseAccountMutation = await acquireAccountMutationTurn(store, user.id);
    try {
      if (isAccountRestricted(user.id)) {
        sendRelayError(res, 403, "account_restricted", "This account is restricted by the relay operator.");
        return;
      }
      if (deletionLedger?.isProtected(user.id)) {
        sendRelayError(
          res,
          403,
          "forbidden",
          "This GitHub identity was deleted from the hosted alpha and cannot sign in while protected backups remain."
        );
        return;
      }

      const sessionId = nanoid(32);
      const sessionIdHash = hashAuthSessionId(sessionId);
      const expiresAt = Date.now() + authSessionMaxAgeMs;
      const evicted = selectAuthSessionsToEvict(
        store.authSessions,
        user.id,
        retainedAuthSessionCapPerUser,
        1,
        Date.now()
      );
      for (const [hash] of evicted) store.authSessions.delete(hash);
      let inserted = false;
      try {
        setAuthSession(sessionId, { user, expiresAt });
        inserted = true;
        await saveRelayStore();
      } catch (error) {
        if (inserted && store.authSessions.get(sessionIdHash)?.user.id === user.id) {
          store.authSessions.delete(sessionIdHash);
        }
        for (const [hash, session] of evicted) store.authSessions.set(hash, session);
        if (error instanceof RelayStoreCapacityError) sendRelayCapacityError(res, error);
        else sendRelayError(res, 503, "persistence_unavailable", "Could not persist the GitHub session.");
        return;
      }

      closeEvictedSessionSockets(store, new Set(evicted.map(([, session]) => session)));
      res.cookie("multaiplayer_session", sessionId, authCookieOptions(authSessionMaxAgeMs));
      res.json({ user });
    } finally {
      releaseAccountMutation();
    }
  }

  app.get("/auth/config", (_req, res) => {
    res.json({
      provider: "github",
      configured: true,
      scopes: ["read:user", "repo"],
      mutationsRequireAuth,
      allowedOrigins: allowedCorsOrigins,
      sessionPersistence: "identity_only",
      accountDeletion: deletionLedger ? "external_ledger_protected" : "primary_store_only"
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
    // Startup reconciliation authenticates the complete external ledger before
    // the listener opens. The account turn below rechecks that cache after any
    // concurrent deletion or operator restriction has finished.
    await issueVerifiedSession(
      {
        id: normalizedUserId,
        login,
        ...(name ? { name } : {}),
        ...(avatarUrl ? { avatarUrl } : {})
      },
      res
    );
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
    const releaseAccountMutation = await acquireAccountMutationTurn(store, userId);
    try {
      if (!isLiveAccountSession(store, session)) {
        return void sendRelayError(res, 401, "authentication_required", "Sign in before deleting hosted account data.");
      }
      const blockers = findAccountDeletionBlockers(store, userId);
      if (hasAccountDeletionBlockers(blockers)) {
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
      const ledgerEntryIds = await recordDeletionProtection(userId);
      if (!ledgerEntryIds) {
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
        deleted = await deleteAccountOwnedRelayDataWithinTurnAtomically(store, userId, saveRelayStore, ledgerEntryIds);
      } catch {
        for (const teamId of memberTeamIds) revokeTeamMemberSessions(teamId, userId);
        revokeUserPresence(userId);
        for (const client of store.sessions.values()) {
          if (client.authSession?.user.id === userId || client.userId === userId) {
            client.socket.close(1008, "Hosted account deletion pending");
          }
        }
        res.clearCookie("multaiplayer_session", authCookieOptions());
        if (!deletionLedger) {
          return void sendRelayError(res, 503, "persistence_unavailable", "Account deletion could not be persisted.");
        }
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
    } finally {
      releaseAccountMutation();
    }
  });
}

function closeEvictedSessionSockets(store: RelayStore, evicted: Set<AuthSession>): void {
  if (evicted.size === 0) return;
  for (const client of store.sessions.values()) {
    if (!client.authSession || !evicted.has(client.authSession)) continue;
    try {
      client.socket.close(1008, "Authentication session replaced");
    } catch {
      // Durable revocation is authoritative; a broken socket cannot undo it.
    }
  }
}

function hasAccountDeletionBlockers(blockers: ReturnType<typeof findAccountDeletionBlockers>): boolean {
  return blockers.ownedTeams.length > 0 || blockers.hostedRooms.length > 0;
}
