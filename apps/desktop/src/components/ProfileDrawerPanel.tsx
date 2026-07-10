import { ClipboardList, ExternalLink, Github, X } from "lucide-react";
import { useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/authClient";
import { buildWebPreviewDiagnosticBundle, saveNativeDiagnosticBundle } from "../lib/diagnostics";
import { copyTextToClipboard } from "../lib/clipboard";
import { isTauriRuntime } from "../lib/localBackend/runtime";
import { InfoRow } from "./common";
import { CodexAccountPanel } from "./CodexAccountPanel";

export function ProfileDrawerPanel({
  currentUser,
  authConfig,
  authBusy,
  authError,
  deviceFlow,
  deviceId,
  deviceIdentity,
  deviceIdentityMessage,
  relaySessionPersistence,
  onRotateDeviceIdentity,
  onSignIn,
  onSignOut
}: {
  currentUser: SignedInUser | null;
  authConfig: GitHubAuthConfig | null;
  authBusy: boolean;
  authError: string | null;
  deviceFlow: GitHubDeviceStart | null;
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
  deviceIdentityMessage: string | null;
  relaySessionPersistence: string;
  onRotateDeviceIdentity: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const nativeDiagnostics = isTauriRuntime();
  async function exportDiagnostics() {
    if (!nativeDiagnostics) {
      const result = await copyTextToClipboard(buildWebPreviewDiagnosticBundle());
      setDiagnosticsMessage(
        result.status === "copied"
          ? "Copied in-memory diagnostics. Review before attaching to a bug report."
          : `Could not copy diagnostics: ${result.reason}`
      );
      return;
    }

    const outcome = await saveNativeDiagnosticBundle();
    setDiagnosticsMessage(
      outcome === "saved"
        ? "Saved local diagnostics. Review the file before attaching it to a bug report."
        : outcome === "cancelled"
          ? "Diagnostics save cancelled."
          : "Could not save diagnostics."
    );
  }

  return (
    <div className="drawer-content">
      <section className="drawer-section account-section">
        {currentUser?.avatarUrl ? (
          <img src={currentUser.avatarUrl} alt="" />
        ) : (
          <div className="drawer-avatar">
            {currentUser ? currentUser.login.slice(0, 1).toUpperCase() : <Github size={24} />}
          </div>
        )}
        <div>
          <strong>{currentUser?.name ?? currentUser?.login ?? "Not signed in"}</strong>
          <span>{currentUser ? `@${currentUser.login}` : "GitHub required for PRs and Actions"}</span>
        </div>
      </section>

      <section className="drawer-section">
        <InfoRow label="GitHub sign-in" value={authConfig?.configured === false ? "Not configured" : "Ready"} />
        <InfoRow label="GitHub access" value={authConfig?.scopes.join(", ") || "Unavailable"} />
        <InfoRow label="App origins" value={authConfig?.allowedOrigins.join(", ") || "Local/default"} />
        <InfoRow label="Workspace edits" value={authConfig?.mutationsRequireAuth ? "Requires sign-in" : "Local only"} />
        <InfoRow label="Relay sessions" value={relaySessionPersistence} />
        <InfoRow label="Session" value={currentUser ? "Signed in" : "Signed out"} />
        <InfoRow label="Device" value={deviceId} />
        <InfoRow label="Device identity" value={deviceIdentity?.publicKeyFingerprint ?? "Preparing"} />
        {currentUser && <InfoRow label="User id" value={currentUser.id} />}
      </section>

      <button className="ghost-wide" onClick={onRotateDeviceIdentity}>
        Reset device identity
      </button>
      {deviceIdentityMessage && <div className="workflow-message">{deviceIdentityMessage}</div>}

      <button className="ghost-wide" onClick={exportDiagnostics}>
        <ClipboardList size={15} />
        {nativeDiagnostics ? "Save diagnostics" : "Copy diagnostics"}
      </button>
      {diagnosticsMessage && <div className="workflow-message">{diagnosticsMessage}</div>}

      <CodexAccountPanel />

      {currentUser ? (
        <button className="ghost-wide" onClick={onSignOut}>
          <X size={15} />
          Sign out
        </button>
      ) : (
        <button className="primary-wide" onClick={onSignIn} disabled={authBusy || authConfig?.configured === false}>
          <Github size={15} />
          {authConfig?.configured === false
            ? "GitHub sign-in not configured"
            : authBusy
              ? "Waiting for GitHub"
              : "Sign in with GitHub"}
        </button>
      )}

      {deviceFlow && (
        <div className="device-flow drawer-flow">
          <span>GitHub code</span>
          <strong>{deviceFlow.user_code}</strong>
          <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">
            Open GitHub <ExternalLink size={13} />
          </a>
        </div>
      )}
      {authError && <div className="auth-error">{authError}</div>}
    </div>
  );
}
