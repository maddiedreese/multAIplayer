import { ExternalLink, Github, KeyRound, X } from "lucide-react";
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
        <InfoRow label="GitHub OAuth" value={authConfig?.configured === false ? "Not configured" : "Configured"} />
        <InfoRow label="OAuth scopes" value={authConfig?.scopes.join(", ") || "Unavailable"} />
        <InfoRow label="Allowed origins" value={authConfig?.allowedOrigins.join(", ") || "Local/default"} />
        <InfoRow label="Workspace edits" value={authConfig?.mutationsRequireAuth ? "Sign-in required" : "Local permissive"} />
        <InfoRow label="Relay sessions" value={relaySessionPersistence} />
        <InfoRow label="Session" value={currentUser ? "Signed in" : "Signed out"} />
        <InfoRow label="Device" value={deviceId} />
        <InfoRow label="Device key" value={deviceIdentity?.publicKeyFingerprint ?? "Generating"} />
        <InfoRow label="Key algorithm" value={deviceIdentity?.algorithm ?? "Unavailable"} />
        {currentUser && <InfoRow label="User id" value={currentUser.id} />}
      </section>

      <button className="ghost-wide" onClick={onRotateDeviceIdentity}>
        <KeyRound size={15} />
        Rotate device key
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
          {authConfig?.configured === false ? "GitHub OAuth not configured" : authBusy ? "Waiting for GitHub" : "Sign in with GitHub"}
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
