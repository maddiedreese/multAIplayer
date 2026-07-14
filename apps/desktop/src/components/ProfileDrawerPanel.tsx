import { ClipboardList, ExternalLink, X } from "lucide-react";
import { GitHubIcon } from "./GitHubIcon";
import { useState } from "react";
import type { DeviceIdentity } from "../lib/deviceIdentity";
import type { GitHubAuthConfig, GitHubDeviceStart, SignedInUser } from "../lib/authClient";
import { saveNativeDiagnosticBundle } from "../lib/diagnostics";
import { InfoRow } from "./common";
import { CodexAccountPanel } from "./CodexAccountPanel";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "../lib/productLinks";
import {
  deleteHostedAccount,
  recheckHostedAccountDeletion,
  hostedAccountDeletionConfirmation,
  type HostedAccountDeletionResult
} from "../lib/authClient";

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
  onHostedAccountDeleted,
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
  onHostedAccountDeleted: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionResult, setDeletionResult] = useState<HostedAccountDeletionResult | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<string | null>(null);
  async function exportDiagnostics() {
    const outcome = await saveNativeDiagnosticBundle();
    setDiagnosticsMessage(
      outcome === "saved"
        ? "Saved local diagnostics. Review the file before attaching it to a bug report."
        : outcome === "cancelled"
          ? "Diagnostics save cancelled."
          : "Could not save diagnostics."
    );
  }

  async function deleteAccount() {
    setDeletionBusy(true);
    setDeletionResult(null);
    try {
      const result = await deleteHostedAccount(deletionConfirmation);
      setDeletionResult(result);
      if (result.status === "deleted") {
        setDeletionConfirmation("");
        onHostedAccountDeleted();
      } else if (result.status === "indeterminate") {
        setDeletionStatus(
          "The configured relay reports this session as signed out after the deletion response was lost. Deletion may have completed, but an expired session can look the same; sign in again to inspect or delete any remaining hosted data."
        );
        onHostedAccountDeleted();
      }
    } catch (error) {
      setDeletionStatus(
        `The configured relay's deletion response could not be confirmed (${String(error)}). The request may have committed even though the response was lost. Recheck account status before retrying.`
      );
    } finally {
      setDeletionBusy(false);
    }
  }

  async function recheckDeletion() {
    setDeletionBusy(true);
    try {
      const result = await recheckHostedAccountDeletion();
      if (result.status === "signed_in") {
        setDeletionStatus(
          "The configured relay still reports this session as signed in, so deletion is not confirmed. Review any blockers and retry the deletion request."
        );
      } else {
        setDeletionStatus(
          "The configured relay reports this session as signed out. Deletion may have completed, but an expired session can look the same; sign in again to inspect or delete any remaining hosted data."
        );
        onHostedAccountDeleted();
      }
    } catch (error) {
      setDeletionStatus(`Account status could not be rechecked: ${String(error)}. Do not assume deletion completed.`);
    } finally {
      setDeletionBusy(false);
    }
  }

  return (
    <div className="drawer-content">
      <section className="drawer-section account-section">
        {currentUser?.avatarUrl ? (
          <img src={currentUser.avatarUrl} alt="" />
        ) : (
          <div className="drawer-avatar">
            {currentUser ? currentUser.login.slice(0, 1).toUpperCase() : <GitHubIcon size={24} />}
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
        Save diagnostics
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
          <GitHubIcon size={15} />
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

      {currentUser && (
        <section className="drawer-section danger-zone">
          <strong>Delete hosted account data</strong>
          <p>
            This removes your current configured relay's sign-in sessions, registered devices and KeyPackages, team
            memberships, and pending invite artifacts. It does not erase shared team or room records, MLS ciphertext and
            routing records, encrypted attachment blobs, or accepted receipts already shared with other members.
          </p>
          <p>
            You must transfer or delete teams you own and hand off rooms you host first. Local encrypted room data is
            controlled separately on this Mac; use each room's <strong>Forget on this device</strong> control to remove
            it.
          </p>
          {!deletionOpen ? (
            <button className="ghost-wide" type="button" onClick={() => setDeletionOpen(true)}>
              Delete hosted account data
            </button>
          ) : (
            <div className="account-deletion-confirmation">
              <label htmlFor="hosted-account-deletion-confirmation">
                Type <strong>{hostedAccountDeletionConfirmation}</strong> to confirm
              </label>
              <input
                id="hosted-account-deletion-confirmation"
                value={deletionConfirmation}
                onChange={(event) => setDeletionConfirmation(event.target.value)}
                autoComplete="off"
              />
              <button
                className="ghost-wide"
                type="button"
                disabled={deletionBusy || deletionConfirmation !== hostedAccountDeletionConfirmation}
                onClick={() => void deleteAccount()}
              >
                {deletionBusy ? "Deleting…" : "Permanently delete hosted account data"}
              </button>
              <button
                className="ghost-wide"
                type="button"
                disabled={deletionBusy}
                onClick={() => {
                  setDeletionOpen(false);
                  setDeletionConfirmation("");
                  setDeletionResult(null);
                  setDeletionStatus(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {deletionResult?.status === "blocked" && (
            <div className="workflow-message" role="status">
              Account deletion is blocked. Transfer or delete {deletionResult.blockers.ownedTeams.length} owned team(s)
              and hand off {deletionResult.blockers.hostedRooms.length} hosted room(s), then try again.
            </div>
          )}
          {deletionResult?.status === "deleted" && (
            <div className="workflow-message" role="status">
              Hosted account data deleted. This app has cleared its signed-in workspace state.
            </div>
          )}
        </section>
      )}

      {deletionStatus && (
        <section className="drawer-section" role="status">
          <strong>Account deletion status</strong>
          <p>{deletionStatus}</p>
          <button className="ghost-wide" type="button" disabled={deletionBusy} onClick={() => void recheckDeletion()}>
            Recheck account status
          </button>
        </section>
      )}

      <section className="drawer-section">
        <strong>Flared Inc.</strong>
        <p>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noreferrer noopener">
            Terms of Service
          </a>
        </p>
      </section>
    </div>
  );
}
