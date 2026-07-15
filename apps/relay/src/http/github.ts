import type { CookieOptions, Express } from "express";
import type { AuthSession, RelayStore } from "../state.js";
import { registerGitHubAuthRoutes } from "../auth/github.js";
import { registerGitHubProxyRoutes } from "./githubProxy.js";
import type { DeletionLedger } from "../auth/deletion-ledger.js";

interface RegisterGitHubRoutesOptions {
  app: Express;
  githubClientId: string | undefined;
  githubOAuthScopes: string[];
  mutationsRequireAuth: boolean;
  allowedCorsOrigins: string[];
  sessionPersistenceSecret: string | null;
  authSessions: Map<string, AuthSession>;
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
  maxGitHubDeviceCodeChars: number;
  maxUserIdChars: number;
  maxDisplayNameChars: number;
  maxRoomProjectPathChars: number;
  maxAccessTokenChars: number;
  maxShortTextChars: number;
  maxMediumTextChars: number;
  maxUrlChars: number;
}

export function registerGitHubRoutes(options: RegisterGitHubRoutesOptions) {
  registerGitHubAuthRoutes(options);
  registerGitHubProxyRoutes(options);
}
