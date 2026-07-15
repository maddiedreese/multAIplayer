import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelCodexLogin,
  createCoalescedAsyncTask,
  listenForCodexHostNotifications,
  logoutCodexAccount,
  readCodexHostSnapshot,
  setCodexAppApprovalMode,
  shouldRefreshCodexHostSnapshot,
  startCodexLogin,
  startCodexMcpLogin,
  type CodexAppApprovalMode,
  type CodexHostSnapshot,
  type CodexLoginStartResult
} from "../lib/platform/localBackend";
import { isTauriRuntime } from "../lib/platform/localBackend/runtime";
import { reportExpectedFailure } from "../lib/core/nonFatalReporting";
import { openTrustedAuthenticationUrl, trustedAuthenticationUrl } from "../lib/identity/authExternalUrl";
import type { CodexAccountReadiness } from "../lib/codex/codexAccountReadiness";

export function projectCodexAccountReadiness({
  native,
  snapshot,
  busy,
  error
}: {
  native: boolean;
  snapshot: CodexHostSnapshot | null;
  busy: boolean;
  error: string | null;
}): CodexAccountReadiness {
  if (!native) {
    return {
      status: "native_required",
      ready: false,
      message: "Codex account controls require the native desktop app."
    };
  }
  if (!snapshot) {
    return busy
      ? { status: "checking", ready: false, message: "Checking Codex and ChatGPT account status…" }
      : { status: "unavailable", ready: false, message: error ?? "Codex account status is unavailable." };
  }
  if (snapshot.requiresOpenaiAuth && !snapshot.account) {
    return {
      status: "sign_in_required",
      ready: false,
      message: "Sign in with ChatGPT to authorize Codex on this device."
    };
  }
  return {
    status: "ready",
    ready: true,
    message: snapshot.account ? "ChatGPT account connected." : "Codex is ready without ChatGPT sign-in."
  };
}

export interface CodexAccountController {
  native: boolean;
  snapshot: CodexHostSnapshot | null;
  login: CodexLoginStartResult | null;
  loginBrowserOpenFailed: boolean;
  mcpLogin: { name: string; url: string } | null;
  busy: boolean;
  message: string | null;
  approvalMode: CodexAppApprovalMode | "";
  readiness: CodexAccountReadiness;
  refresh: () => Promise<void>;
  beginLogin: (flow: "browser" | "device") => Promise<void>;
  cancelLogin: () => Promise<void>;
  signOut: () => Promise<void>;
  connectMcp: (name: string) => Promise<void>;
  updateApprovalMode: (mode: CodexAppApprovalMode) => Promise<void>;
}

const CodexAccountContext = createContext<CodexAccountController | null>(null);

export function CodexAccountProvider({ children }: { children: React.ReactNode }) {
  const controller = useCodexAccountController();
  return <CodexAccountContext.Provider value={controller}>{children}</CodexAccountContext.Provider>;
}

export function useCodexAccount(): CodexAccountController {
  const controller = useContext(CodexAccountContext);
  if (!controller) throw new Error("useCodexAccount must be used within CodexAccountProvider.");
  return controller;
}

function useCodexAccountController(): CodexAccountController {
  const native = isTauriRuntime();
  const [snapshot, setSnapshot] = useState<CodexHostSnapshot | null>(null);
  const [login, setLogin] = useState<CodexLoginStartResult | null>(null);
  const [loginBrowserOpenFailed, setLoginBrowserOpenFailed] = useState(false);
  const [mcpLogin, setMcpLogin] = useState<{ name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(native);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalMode, setApprovalMode] = useState<CodexAppApprovalMode | "">("");
  const refreshStartedAt = useRef(0);

  const performRefresh = useCallback(async () => {
    if (!native) return;
    refreshStartedAt.current = Date.now();
    setBusy(true);
    try {
      setSnapshot(await readCodexHostSnapshot());
      setMessage(null);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [native]);
  const refreshTask = useMemo(() => createCoalescedAsyncTask(performRefresh), [performRefresh]);
  const refresh = useCallback(() => refreshTask.request(), [refreshTask]);

  useEffect(() => {
    void refresh().catch(() => reportExpectedFailure("coalesced Codex account refresh was cancelled"));
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void listenForCodexHostNotifications((notification) => {
      if (notification.method === "account/login/completed") {
        setLoginBrowserOpenFailed(false);
        setMessage(
          notification.params.success === true
            ? "Codex sign-in completed."
            : String(notification.params.error ?? "Codex sign-in failed.")
        );
        setLogin(null);
      } else if (notification.method === "mcpServer/oauthLogin/completed") {
        setMessage(
          notification.params.success === true
            ? `${String(notification.params.name ?? "MCP server")} connected.`
            : String(notification.params.error ?? "MCP sign-in failed.")
        );
      }
      if (shouldRefreshCodexHostSnapshot(notification.method, Date.now() - refreshStartedAt.current)) {
        void refresh().catch(() => reportExpectedFailure("coalesced Codex account refresh was cancelled"));
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
      refreshTask.cancelPending();
    };
  }, [refresh, refreshTask]);

  const beginLogin = useCallback(
    async (flow: "browser" | "device") => {
      setLoginBrowserOpenFailed(false);
      setBusy(true);
      try {
        const useHostedLoginSuccessPage =
          flow === "browser" ? snapshot?.capabilities.supportsHostedLoginSuccess : false;
        const next = await startCodexLogin(flow, {
          ...(useHostedLoginSuccessPage === undefined ? {} : { useHostedLoginSuccessPage }),
          appBrand: "chatgpt"
        });
        const trustedUrl = trustedAuthenticationUrl("openai", next.url);
        if (!trustedUrl) {
          await cancelCodexLogin(next.loginId).catch(() =>
            reportExpectedFailure("cancel Codex login after rejecting its authorization URL")
          );
          throw new Error("Codex returned an unsupported ChatGPT authorization address.");
        }
        const trustedLogin = { ...next, url: trustedUrl };
        setLogin(trustedLogin);
        if (flow === "browser") {
          setLoginBrowserOpenFailed(!(await openTrustedAuthenticationUrl("openai", trustedUrl)));
        }
        setMessage("Complete sign-in in the link below. Credentials remain in Codex on this device.");
      } catch (error) {
        setMessage(String(error));
      } finally {
        setBusy(false);
      }
    },
    [snapshot?.capabilities.supportsHostedLoginSuccess]
  );

  const cancelLogin = useCallback(async () => {
    if (!login) return;
    setBusy(true);
    try {
      await cancelCodexLogin(login.loginId);
      setLoginBrowserOpenFailed(false);
      setLogin(null);
      setMessage("Codex sign-in cancelled.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [login]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await logoutCodexAccount();
      setLoginBrowserOpenFailed(false);
      setLogin(null);
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connectMcp = useCallback(async (name: string) => {
    setBusy(true);
    try {
      const result = await startCodexMcpLogin(name);
      setMcpLogin({ name, url: result.authorizationUrl });
      setMessage(`Open the authorization link to connect ${name}.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const updateApprovalMode = useCallback(async (mode: CodexAppApprovalMode) => {
    setBusy(true);
    try {
      await setCodexAppApprovalMode(mode);
      setApprovalMode(mode);
      setMessage(
        mode === "writes"
          ? "Apps now prompt for writes while declared read-only tools proceed."
          : `Default app approval mode set to ${mode}.`
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const readiness = useMemo(
    () => projectCodexAccountReadiness({ native, snapshot, busy, error: snapshot ? null : message }),
    [busy, message, native, snapshot]
  );

  return useMemo(
    () => ({
      native,
      snapshot,
      login,
      loginBrowserOpenFailed,
      mcpLogin,
      busy,
      message,
      approvalMode,
      readiness,
      refresh,
      beginLogin,
      cancelLogin,
      signOut,
      connectMcp,
      updateApprovalMode
    }),
    [
      approvalMode,
      beginLogin,
      busy,
      cancelLogin,
      connectMcp,
      login,
      loginBrowserOpenFailed,
      mcpLogin,
      message,
      native,
      readiness,
      refresh,
      signOut,
      snapshot,
      updateApprovalMode
    ]
  );
}
