import { ExternalLink, LogIn, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import type { CodexAppApprovalMode } from "../lib/localBackend";
import { useCodexAccount } from "../hooks/useCodexAccount";
import { InfoRow } from "./common";

export function CodexAccountPanel() {
  const {
    native,
    snapshot,
    login,
    mcpLogin,
    busy,
    message,
    approvalMode,
    refresh,
    beginLogin,
    cancelLogin,
    signOut,
    connectMcp,
    updateApprovalMode
  } = useCodexAccount();

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
        <button
          className="icon-button"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label="Refresh Codex account"
        >
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
          <button
            className="primary-wide"
            onClick={() => void beginLogin("browser")}
            disabled={busy || !snapshot?.capabilities.supportsBrowserLogin}
          >
            <LogIn size={15} /> Sign in with ChatGPT
          </button>
          <button
            className="ghost-wide"
            onClick={() => void beginLogin("device")}
            disabled={busy || !snapshot?.capabilities.supportsDeviceLogin}
          >
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
          <a href={login.url} target="_blank" rel="noreferrer">
            Open ChatGPT <ExternalLink size={13} />
          </a>
          <button className="ghost-wide" onClick={() => void cancelLogin()} disabled={busy}>
            Cancel sign-in
          </button>
        </div>
      )}

      <label className="codex-approval-mode">
        <span>
          <ShieldCheck size={14} /> Global app tool approvals
        </span>
        <select
          value={approvalMode}
          disabled={busy || !snapshot?.capabilities.supportsApps}
          onChange={(event) => void updateApprovalMode(event.target.value as CodexAppApprovalMode)}
        >
          <option value="" disabled>
            Choose a default…
          </option>
          <option value="auto">Automatic</option>
          <option value="prompt">Always prompt</option>
          {snapshot?.capabilities.supportsWritesApproval && <option value="writes">Prompt for writes</option>}
        </select>
        <small>
          This persists in the device-wide Codex config and affects other Codex clients. “Prompt for writes” trusts only
          tools that declare themselves read-only.
        </small>
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
          <a href={mcpLogin.url} target="_blank" rel="noreferrer">
            Open authorization <ExternalLink size={13} />
          </a>
        </div>
      )}

      <div className="codex-host-list">
        <strong>MCP servers ({snapshot?.mcpServers.length ?? 0})</strong>
        {snapshot?.mcpError && <small>{snapshot.mcpError}</small>}
        {snapshot?.mcpServers.map((server) => (
          <div key={server.name} className="codex-host-row">
            <span>
              {server.name}
              <small>
                {server.toolCount} tools · {server.authStatus}
              </small>
            </span>
            {server.authStatus === "notLoggedIn" && (
              <button className="secondary" onClick={() => void connectMcp(server.name)} disabled={busy}>
                Connect
              </button>
            )}
          </div>
        ))}
      </div>

      {message && <div className="workflow-message">{message}</div>}
    </section>
  );
}
