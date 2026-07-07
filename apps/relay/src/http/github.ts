import type { CookieOptions, Express } from "express";
import type { AuthSession } from "../state.js";
import { registerGitHubAuthRoutes } from "../auth/github.js";
import { registerGitHubProxyRoutes } from "./githubProxy.js";

interface RegisterGitHubRoutesOptions {
  app: Express;
  githubClientId: string | undefined;
  githubOAuthScopes: string[];
  mutationsRequireAuth: boolean;
  allowedCorsOrigins: string[];
  sessionPersistenceSecret: string | null;
  authSessions: Map<string, AuthSession>;
  authSessionMaxAgeMs: number;
  authCookieOptions: (maxAge?: number) => CookieOptions;
  getAuthSession: (sessionId: unknown) => AuthSession | null;
  scheduleStoreSave: () => void;
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
