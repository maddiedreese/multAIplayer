import { ExternalLink, LogIn, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
} from "../lib/localBackend";
import { isTauriRuntime } from "../lib/localBackend/runtime";
import { InfoRow } from "./common";

export function CodexAccountPanel() {
  const native = isTauriRuntime();
  const [snapshot, setSnapshot] = useState<CodexHostSnapshot | null>(null);
  const [login, setLogin] = useState<CodexLoginStartResult | null>(null);
  const [mcpLogin, setMcpLogin] = useState<{ name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
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
  const refreshTask = useMemo(
    () => createCoalescedAsyncTask(performRefresh),
    [performRefresh]
  );

  useEffect(() => {
    void refreshTask.request().catch(() => undefined);
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void listenForCodexHostNotifications((notification) => {
      if (notification.method === "account/login/completed") {
        setMessage(notification.params.success === true ? "Codex sign-in completed." : String(notification.params.error ?? "Codex sign-in failed."));
        setLogin(null);
      } else if (notification.method === "mcpServer/oauthLogin/completed") {
        setMessage(notification.params.success === true ? `${String(notification.params.name ?? "MCP server")} connected.` : String(notification.params.error ?? "MCP sign-in failed."));
      }
      if (shouldRefreshCodexHostSnapshot(notification.method, Date.now() - refreshStartedAt.current)) {
        void refreshTask.request().catch(() => undefined);
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
  }, [refreshTask]);

  async function beginLogin(flow: "browser" | "device") {
    setBusy(true);
    try {
      const next = await startCodexLogin(flow, {
        useHostedLoginSuccessPage: flow === "browser" && snapshot?.capabilities.supportsHostedLoginSuccess,
        appBrand: "chatgpt"
      });
      setLogin(next);
      setMessage("Complete sign-in in the link below. Credentials remain in Codex on this device.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancelLogin() {
    if (!login) return;
    setBusy(true);
    try {
      await cancelCodexLogin(login.loginId);
      setLogin(null);
      setMessage("Codex sign-in cancelled.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await logoutCodexAccount();
      setLogin(null);
      await refreshTask.request();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function connectMcp(name: string) {
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
  }

  async function updateApprovalMode(mode: CodexAppApprovalMode) {
    setBusy(true);
    try {
      await setCodexAppApprovalMode(mode);
      setApprovalMode(mode);
      setMessage(mode === "writes" ? "Apps now prompt for writes while declared read-only tools proceed." : `Default app approval mode set to ${mode}.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!native) {
    return (
      <section className="drawer-section codex-account-panel">
        <h3>Codex on this device</h3>
        <span>Account, app, and MCP controls are available in the native desktop app.</span>
      </section>
    );
  }

  return (
    <section className="drawer-section codex-account-panel">
      <div className="panel-title">
        <div>
          <strong>Codex on this device</strong>
          <small>Host-local account and connector controls</small>
        </div>
        <button className="icon-button" onClick={() => void refreshTask.request()} disabled={busy} aria-label="Refresh Codex account">
          <RefreshCw size={15} />
        </button>
      </div>

      <InfoRow label="Codex" value={snapshot?.capabilities.codexVersion ?? (busy ? "Checking" : "Unavailable")} />
      <InfoRow label="Account" value={snapshot?.account?.email ?? snapshot?.account?.accountType ?? "Signed out"} />
      {snapshot?.account?.planType && <InfoRow label="Plan" value={snapshot.account.planType} />}
      {snapshot?.capabilities.compatibilityWarning && (
        <div className="workflow-message">{snapshot.capabilities.compatibilityWarning}</div>
      )}

      {!snapshot?.account ? (
        <div className="codex-account-actions">
          <button className="primary-wide" onClick={() => void beginLogin("browser")} disabled={busy || !snapshot?.capabilities.supportsBrowserLogin}>
            <LogIn size={15} /> Sign in with ChatGPT
          </button>
          <button className="ghost-wide" onClick={() => void beginLogin("device")} disabled={busy || !snapshot?.capabilities.supportsDeviceLogin}>
            Use device code
          </button>
        </div>
      ) : (
        <button className="ghost-wide" onClick={() => void signOut()} disabled={busy}>
          <LogOut size={15} /> Sign out of Codex
        </button>
      )}

      {login && (
        <div className="device-flow drawer-flow">
          <span>{login.flow === "device" ? "ChatGPT device code" : "ChatGPT sign-in"}</span>
          {login.userCode && <strong>{login.userCode}</strong>}
          <a href={login.url} target="_blank" rel="noreferrer">Open ChatGPT <ExternalLink size={13} /></a>
          <button className="ghost-wide" onClick={() => void cancelLogin()} disabled={busy}>Cancel sign-in</button>
        </div>
      )}

      <label className="codex-approval-mode">
        <span><ShieldCheck size={14} /> Global app tool approvals</span>
        <select
          value={approvalMode}
          disabled={busy || !snapshot?.capabilities.supportsApps}
          onChange={(event) => void updateApprovalMode(event.target.value as CodexAppApprovalMode)}
        >
          <option value="" disabled>Choose a default…</option>
          <option value="auto">Automatic</option>
          <option value="prompt">Always prompt</option>
          {snapshot?.capabilities.supportsWritesApproval && <option value="writes">Prompt for writes</option>}
        </select>
        <small>This persists in the device-wide Codex config and affects other Codex clients. “Prompt for writes” trusts only tools that declare themselves read-only.</small>
      </label>

      <div className="codex-host-list">
        <strong>Apps ({snapshot?.apps.length ?? 0})</strong>
        {snapshot?.appsError && <small>{snapshot.appsError}</small>}
        {snapshot?.apps.slice(0, 8).map((app) => (
          <div key={app.id} className="codex-host-row">
            <span>{app.name}</span>
            <small>{app.enabled ? (app.accessible ? "Ready" : "Sign-in needed") : "Disabled"}</small>
          </div>
        ))}
      </div>

      {mcpLogin && (
        <div className="device-flow drawer-flow">
          <span>{mcpLogin.name} authorization</span>
          <a href={mcpLogin.url} target="_blank" rel="noreferrer">Open authorization <ExternalLink size={13} /></a>
        </div>
      )}

      <div className="codex-host-list">
        <strong>MCP servers ({snapshot?.mcpServers.length ?? 0})</strong>
        {snapshot?.mcpError && <small>{snapshot.mcpError}</small>}
        {snapshot?.mcpServers.map((server) => (
          <div key={server.name} className="codex-host-row">
            <span>{server.name}<small>{server.toolCount} tools · {server.authStatus}</small></span>
            {server.authStatus === "notLoggedIn" && (
              <button className="secondary" onClick={() => void connectMcp(server.name)} disabled={busy}>Connect</button>
            )}
          </div>
        ))}
      </div>

      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
