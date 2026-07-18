import { useCallback, useEffect, useState } from "react";
import {
  getAuthConfig,
  githubDevicePollDelayMs,
  logout,
  nextGitHubDevicePollIntervalSeconds,
  pollGitHubDeviceFlow,
  restoreGitHubSession,
  startGitHubDeviceFlow,
  type GitHubAuthConfig
} from "../lib/identity/authClient";
import { useAppStore } from "../store/appStore";
import { openTrustedAuthenticationUrl } from "../lib/identity/authExternalUrl";
import { invokeNative } from "../lib/platform/nativeCommandError";
import { clearDeviceSession } from "../lib/identity/deviceSession";

const fallbackAuthConfig: GitHubAuthConfig = {
  provider: "github",
  configured: false,
  scopes: ["read:user"],
  mutationsRequireAuth: false,
  allowedOrigins: [],
  sessionPersistence: "identity_only"
};

export function useGitHubAuth(relayHttpUrl: string) {
  const [authConfigResolved, setAuthConfigResolved] = useState(false);
  const [currentUserResolved, setCurrentUserResolved] = useState(false);
  const [authBootstrapAttempt, setAuthBootstrapAttempt] = useState(0);
  const [authenticationBrowserOpenFailed, setAuthenticationBrowserOpenFailed] = useState(false);
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
  const identityResolved =
    authConfigResolved && currentUserResolved && (currentUser !== null || authConfig?.mutationsRequireAuth === false);

  useEffect(() => {
    let cancelled = false;
    setAuthConfigResolved(false);
    setCurrentUserResolved(false);
    setAuthError(null);
    if (!relayHttpUrl) {
      setAuthConfig(fallbackAuthConfig);
      setCurrentUser(null);
      setAuthError("Relay is not configured for this build.");
      setAuthConfigResolved(true);
      setCurrentUserResolved(true);
      return () => {
        cancelled = true;
      };
    }
    getAuthConfig()
      .then((config) => {
        if (cancelled) return;
        setAuthConfig(config);
        setAuthConfigResolved(true);
      })
      .catch((error) => {
        if (cancelled) return;
        // A transport failure is not evidence that authentication is optional.
        // Settle into an explicit fail-closed state that onboarding can retry.
        setAuthConfig(null);
        setAuthError(String(error));
        setAuthConfigResolved(true);
      });
    restoreGitHubSession()
      .then((user) => {
        if (!cancelled) setCurrentUser(user);
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      })
      .finally(() => {
        if (!cancelled) setCurrentUserResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authBootstrapAttempt, relayHttpUrl, setAuthConfig, setAuthError, setCurrentUser]);

  const retryAuthBootstrap = useCallback(() => {
    setAuthBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!deviceFlow || currentUser) return;
    let cancelled = false;
    let timer: number | undefined;
    let intervalSeconds = Math.max(1, deviceFlow.interval);
    const poll = () => {
      if (Date.now() >= deviceFlow.expiresAt) {
        setAuthenticationBrowserOpenFailed(false);
        setAuthBusy(false);
        setAuthError("The GitHub sign-in code expired. Start sign-in again.");
        setDeviceFlow(null);
        return;
      }
      pollGitHubDeviceFlow(deviceFlow.flow_id)
        .then((result) => {
          if (cancelled) return;
          if (result.status === "complete") {
            setAuthenticationBrowserOpenFailed(false);
            setCurrentUser(result.user);
            setDeviceFlow(null);
            setAuthBusy(false);
            setAuthError(null);
            return;
          }
          intervalSeconds = nextGitHubDevicePollIntervalSeconds(intervalSeconds, result);
          timer = window.setTimeout(poll, githubDevicePollDelayMs(intervalSeconds, deviceFlow.expiresAt));
        })
        .catch((error) => {
          if (cancelled) return;
          setAuthenticationBrowserOpenFailed(false);
          setAuthBusy(false);
          setAuthError(String(error));
          setDeviceFlow(null);
        });
    };
    timer = window.setTimeout(poll, githubDevicePollDelayMs(intervalSeconds, deviceFlow.expiresAt));
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [currentUser, deviceFlow, setAuthBusy, setAuthError, setCurrentUser, setDeviceFlow]);

  const beginGitHubSignIn = useCallback(async () => {
    setAuthenticationBrowserOpenFailed(false);
    setAuthBusy(true);
    setAuthError(null);
    try {
      const flow = await startGitHubDeviceFlow();
      setDeviceFlow(flow);
      setAuthenticationBrowserOpenFailed(!(await openTrustedAuthenticationUrl("github", flow.verification_uri)));
    } catch (error) {
      setAuthError(String(error));
      setAuthBusy(false);
    }
  }, [setAuthBusy, setAuthError, setDeviceFlow]);

  const cancelGitHubSignIn = useCallback(() => {
    if (deviceFlow) void invokeNative<void>("github_device_flow_cancel", { flowId: deviceFlow.flow_id });
    setAuthenticationBrowserOpenFailed(false);
    setDeviceFlow(null);
    setAuthBusy(false);
    setAuthError(null);
  }, [deviceFlow, setAuthBusy, setAuthError, setDeviceFlow]);

  const signOutGitHub = useCallback(async () => {
    try {
      await logout();
    } finally {
      clearDeviceSession();
      const store = useAppStore.getState();
      store.replaceDeviceIdentity(null);
      store.replaceDeviceSessionToken(null);
      setAuthenticationBrowserOpenFailed(false);
      setCurrentUser(null);
      setDeviceFlow(null);
      setAuthBusy(false);
    }
  }, [setAuthBusy, setCurrentUser, setDeviceFlow]);

  const clearDeletedHostedAccount = useCallback(() => {
    setAuthenticationBrowserOpenFailed(false);
    useAppStore.getState().resetAppStore();
    setCurrentUser(null);
    setDeviceFlow(null);
    setAuthBusy(false);
    setAuthError(null);
  }, [setAuthBusy, setAuthError, setCurrentUser, setDeviceFlow]);

  return {
    authConfig,
    authConfigResolved,
    currentUser,
    currentUserResolved,
    deviceFlow,
    authError,
    authBusy,
    authenticationBrowserOpenFailed,
    identityResolved,
    retryAuthBootstrap,
    beginGitHubSignIn,
    cancelGitHubSignIn,
    signOutGitHub,
    clearDeletedHostedAccount
  };
}
