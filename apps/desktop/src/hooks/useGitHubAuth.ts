import { useCallback, useEffect, useState } from "react";
import {
  getAuthConfig,
  getCurrentUser,
  logout,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow,
  type GitHubAuthConfig,
  type GitHubDeviceStart,
  type SignedInUser
} from "../lib/authClient";

const fallbackAuthConfig: GitHubAuthConfig = {
  provider: "github",
  configured: false,
  scopes: ["read:user"],
  mutationsRequireAuth: false,
  allowedOrigins: [],
  sessionPersistence: "memory_only"
};

export function useGitHubAuth(relayHttpUrl: string) {
  const [authConfig, setAuthConfig] = useState<GitHubAuthConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<SignedInUser | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<GitHubDeviceStart | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    setAuthError(null);
    getAuthConfig().then(setAuthConfig).catch((error) => {
      setAuthConfig(fallbackAuthConfig);
      setAuthError(String(error));
    });
    getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, [relayHttpUrl]);

  useEffect(() => {
    if (!deviceFlow || currentUser) return;
    let cancelled = false;
    const intervalMs = Math.max(1, deviceFlow.interval) * 1000;
    const timer = window.setInterval(() => {
      pollGitHubDeviceFlow(deviceFlow.device_code)
        .then((user) => {
          if (cancelled || !user) return;
          setCurrentUser(user);
          setDeviceFlow(null);
          setAuthBusy(false);
          setAuthError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setAuthBusy(false);
          setAuthError(String(error));
          setDeviceFlow(null);
        });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser, deviceFlow]);

  const beginGitHubSignIn = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const flow = await startGitHubDeviceFlow();
      setDeviceFlow(flow);
      window.open(flow.verification_uri, "_blank", "noopener,noreferrer");
    } catch (error) {
      setAuthError(String(error));
      setAuthBusy(false);
    }
  }, []);

  const signOutGitHub = useCallback(async () => {
    await logout();
    setCurrentUser(null);
    setDeviceFlow(null);
    setAuthBusy(false);
  }, []);

  return {
    authConfig,
    currentUser,
    deviceFlow,
    authError,
    authBusy,
    beginGitHubSignIn,
    signOutGitHub
  };
}
