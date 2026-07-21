import { ExternalLink, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useCodexAccount, type CodexAccountController } from "../hooks/useCodexAccount";
import { InfoRow } from "./common";

export function CodexAccountPanel() {
  return <CodexAccountPanelView controller={useCodexAccount()} />;
}

export function CodexAccountPanelView({ controller }: { controller: CodexAccountController }) {
  if (!controller.native) return <CodexUnavailablePanel />;
  return <CodexNativeAccountPanel controller={controller} />;
}

function CodexUnavailablePanel() {
  return (
    <section className="drawer-section codex-account-panel">
      <h3>Codex on this device</h3>
      <span>Account, app, and MCP controls are available in the native desktop app.</span>
    </section>
  );
}

function CodexNativeAccountPanel({ controller }: { controller: CodexAccountController }) {
  return (
    <section className="drawer-section codex-account-panel">
      <CodexAccountSummary controller={controller} />
      <CodexLoginControls controller={controller} />
      {controller.message && <div className="workflow-message">{controller.message}</div>}
    </section>
  );
}

function CodexAccountSummary({ controller }: { controller: CodexAccountController }) {
  const { snapshot, busy, refresh } = controller;
  return (
    <>
      <div className="panel-title">
        <div>
          <strong>Codex on this device</strong>
          <small>Host-local Codex account</small>
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
    </>
  );
}

function CodexLoginControls({ controller }: { controller: CodexAccountController }) {
  const { snapshot, login, busy, beginLogin, cancelLogin, signOut } = controller;
  return (
    <>
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
    </>
  );
}
