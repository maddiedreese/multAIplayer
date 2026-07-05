import { ExternalLink, Github, X } from "lucide-react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/authClient";
import { InfoRow } from "./common";

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

      {currentUser ? (
        <button className="ghost-wide" onClick={onSignOut}>
          <X size={15} />
          Sign out
        </button>
      ) : (
        <button
          className="primary-wide"
          onClick={onSignIn}
          disabled={authBusy || authConfig?.configured === false}
        >
          <Github size={15} />
          {authConfig?.configured === false ? "GitHub sign-in not configured" : authBusy ? "Waiting for GitHub" : "Sign in with GitHub"}
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
