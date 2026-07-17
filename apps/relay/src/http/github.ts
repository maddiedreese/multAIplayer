import type { CookieOptions, Express } from "express";
import type { AuthSession, NewAuthSession, RelayStore } from "../state.js";
import { registerGitHubAuthRoutes } from "../auth/github.js";
import type { DeletionLedger } from "../auth/deletion-ledger.js";

interface RegisterGitHubRoutesOptions {
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
  maxShortTextChars: number;
  maxMediumTextChars: number;
  maxUrlChars: number;
}

export function registerGitHubRoutes(options: RegisterGitHubRoutesOptions) {
  registerGitHubAuthRoutes(options);
}
