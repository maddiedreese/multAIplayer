import { useCallback, useEffect } from "react";
import {
  getAuthConfig,
  getCurrentUser,
  logout,
  pollGitHubDeviceFlow,
  startGitHubDeviceFlow,
  type GitHubAuthConfig
} from "../lib/authClient";
import { useAppStore } from "../store/appStore";

const fallbackAuthConfig: GitHubAuthConfig = {
  provider: "github",
  configured: false,
  scopes: ["read:user"],
  mutationsRequireAuth: false,
  allowedOrigins: [],
  sessionPersistence: "memory_only"
};

export function useGitHubAuth(relayHttpUrl: string) {
  const authConfig = useAppStore((state) => state.authConfig);
  const currentUser = useAppStore((state) => state.currentUser);
  const deviceFlow = useAppStore((state) => state.deviceFlow);
  const authError = useAppStore((state) => state.authError);
  const authBusy = useAppStore((state) => state.authBusy);
  const setAuthConfig = useAppStore((state) => state.replaceAuthConfig);
  const setCurrentUser = useAppStore((state) => state.replaceCurrentUser);
  const setDeviceFlow = useAppStore((state) => state.replaceDeviceFlow);
  const setAuthError = useAppStore((state) => state.setAuthError);
  const setAuthBusy = useAppStore((state) => state.setAuthBusy);

  useEffect(() => {
    setAuthError(null);
    getAuthConfig()
      .then(setAuthConfig)
      .catch((error) => {
        setAuthConfig(fallbackAuthConfig);
        setAuthError(String(error));
      });
    getCurrentUser()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null));
  }, [relayHttpUrl, setAuthConfig, setAuthError, setCurrentUser]);

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
  }, [currentUser, deviceFlow, setAuthBusy, setAuthError, setCurrentUser, setDeviceFlow]);

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
  }, [setAuthBusy, setAuthError, setDeviceFlow]);

  const signOutGitHub = useCallback(async () => {
    await logout();
    setCurrentUser(null);
    setDeviceFlow(null);
    setAuthBusy(false);
  }, [setAuthBusy, setCurrentUser, setDeviceFlow]);

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
