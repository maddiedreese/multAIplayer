import { ClipboardList, ExternalLink, X } from "lucide-react";
import { GitHubIcon } from "./GitHubIcon";
import { useState } from "react";
import type { ReactNode } from "react";
import type { DeviceIdentity } from "../lib/identity/deviceIdentity";
import type { DeviceRecord } from "@multaiplayer/protocol";
import { saveNativeDiagnosticBundle } from "../lib/platform/diagnostics";
import { InfoRow } from "./common";
import { CodexAccountPanel } from "./CodexAccountPanel";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "../lib/core/productLinks";
import {
  deleteHostedAccount,
  listHostedDevices,
  retireHostedDevice,
  recheckHostedAccountDeletion,
  hostedAccountDeletionConfirmation,
  summarizeGitHubOAuthPurposes,
  type GitHubAuthConfig,
  type GitHubDeviceStart,
  type SignedInUser,
  type HostedAccountDeletionResult
} from "../lib/identity/authClient";

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
  codexAccountPanel = <CodexAccountPanel />,
  archivePanel,
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
  codexAccountPanel?: ReactNode;
  archivePanel?: ReactNode;
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
  const [deviceManagerOpen, setDeviceManagerOpen] = useState(false);
  const [hostedDevices, setHostedDevices] = useState<DeviceRecord[]>([]);
  const [deviceManagementBusy, setDeviceManagementBusy] = useState(false);
  const [deviceManagementStatus, setDeviceManagementStatus] = useState<string | null>(null);
  const [retirementTarget, setRetirementTarget] = useState<string | null>(null);
  const [retirementConfirmation, setRetirementConfirmation] = useState("");
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
      } else if (result.status === "pending") {
        setDeletionConfirmation("");
        setDeletionStatus(
          "The relay durably accepted the deletion request and signed this identity out. Primary cleanup is pending and will be retried before the relay next accepts traffic."
        );
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

  async function openDeviceManager() {
    setDeviceManagerOpen(true);
    setDeviceManagementBusy(true);
    setDeviceManagementStatus(null);
    try {
      setHostedDevices(await listHostedDevices());
    } catch (error) {
      setDeviceManagementStatus(String(error));
    } finally {
      setDeviceManagementBusy(false);
    }
  }

  async function retireDevice() {
    if (!retirementTarget || retirementConfirmation !== retirementTarget) return;
    setDeviceManagementBusy(true);
    setDeviceManagementStatus(null);
    try {
      await retireHostedDevice(retirementTarget);
      setHostedDevices((devices) => devices.filter((device) => device.deviceId !== retirementTarget));
      setDeviceManagementStatus(`Retired ${retirementTarget}. Its old MLS state was not recovered.`);
      setRetirementTarget(null);
      setRetirementConfirmation("");
    } catch (error) {
      setDeviceManagementStatus(String(error));
    } finally {
      setDeviceManagementBusy(false);
    }
  }

  return (
    <div className="drawer-content">
      <ProfileIdentity currentUser={currentUser} />
      <ProfileEnvironment
        currentUser={currentUser}
        authConfig={authConfig}
        relaySessionPersistence={relaySessionPersistence}
        deviceId={deviceId}
        deviceIdentity={deviceIdentity}
      />

      {deviceIdentityMessage && <div className="workflow-message">{deviceIdentityMessage}</div>}

      <button className="ghost-wide" onClick={exportDiagnostics}>
        <ClipboardList size={15} />
        Save diagnostics
      </button>
      {diagnosticsMessage && <div className="workflow-message">{diagnosticsMessage}</div>}

      {codexAccountPanel}

      {archivePanel}

      <ProfileSignInControls
        currentUser={currentUser}
        authBusy={authBusy}
        authConfigured={authConfig?.configured !== false}
        authError={authError}
        deviceFlow={deviceFlow}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />

      {currentUser && (
        <RegisteredDevicesSection
          open={deviceManagerOpen}
          devices={hostedDevices}
          currentDeviceId={deviceId}
          busy={deviceManagementBusy}
          status={deviceManagementStatus}
          retirementTarget={retirementTarget}
          retirementConfirmation={retirementConfirmation}
          onOpen={() => void openDeviceManager()}
          onRetirementTargetChange={(target) => {
            setRetirementTarget(target);
            setRetirementConfirmation("");
          }}
          onRetirementConfirmationChange={setRetirementConfirmation}
          onRetire={() => void retireDevice()}
          onClose={() => {
            setDeviceManagerOpen(false);
            setRetirementTarget(null);
            setRetirementConfirmation("");
            setDeviceManagementStatus(null);
          }}
        />
      )}

      {currentUser && (
        <HostedAccountDeletionSection
          open={deletionOpen}
          confirmation={deletionConfirmation}
          busy={deletionBusy}
          result={deletionResult}
          onOpen={() => setDeletionOpen(true)}
          onConfirmationChange={setDeletionConfirmation}
          onDelete={() => void deleteAccount()}
          onCancel={() => {
            setDeletionOpen(false);
            setDeletionConfirmation("");
            setDeletionResult(null);
            setDeletionStatus(null);
          }}
        />
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

function ProfileIdentity({ currentUser }: { currentUser: SignedInUser | null }) {
  return (
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
  );
}

function ProfileEnvironment({
  currentUser,
  authConfig,
  relaySessionPersistence,
  deviceId,
  deviceIdentity
}: {
  currentUser: SignedInUser | null;
  authConfig: GitHubAuthConfig | null;
  relaySessionPersistence: string;
  deviceId: string;
  deviceIdentity: DeviceIdentity | null;
}) {
  const oauthPurposes = summarizeGitHubOAuthPurposes(authConfig?.scopes ?? []);
  return (
    <section className="drawer-section">
      <InfoRow label="GitHub sign-in" value={authConfig?.configured === false ? "Not configured" : "Ready"} />
      <InfoRow label="GitHub identity scope" value={oauthPurposes.identity} />
      <InfoRow label="Repository workflow scope" value={oauthPurposes.repositoryWorkflows} />
      <InfoRow label="App origins" value={authConfig?.allowedOrigins.join(", ") || "Local/default"} />
      <InfoRow label="Workspace edits" value={authConfig?.mutationsRequireAuth ? "Requires sign-in" : "Local only"} />
      <InfoRow label="Relay sessions" value={relaySessionPersistence} />
      <InfoRow label="Session" value={currentUser ? "Signed in" : "Signed out"} />
      <InfoRow label="Device" value={deviceId} />
      <InfoRow label="Device identity" value={deviceIdentity?.publicKeyFingerprint ?? "Preparing"} />
      {currentUser && <InfoRow label="User id" value={currentUser.id} />}
    </section>
  );
}

function ProfileSignInControls({
  currentUser,
  authBusy,
  authConfigured,
  authError,
  deviceFlow,
  onSignIn,
  onSignOut
}: {
  currentUser: SignedInUser | null;
  authBusy: boolean;
  authConfigured: boolean;
  authError: string | null;
  deviceFlow: GitHubDeviceStart | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      {currentUser ? (
        <button className="ghost-wide" onClick={onSignOut}>
          <X size={15} /> Sign out
        </button>
      ) : (
        <>
          <p>
            GitHub sign-in establishes workspace identity. The same alpha grant also requests <code>repo</code> for
            optional pull-request and Actions API workflows, including private repositories available to your account.
          </p>
          <button className="primary-wide" onClick={onSignIn} disabled={authBusy || !authConfigured}>
            <GitHubIcon size={15} />
            {!authConfigured
              ? "GitHub sign-in not configured"
              : authBusy
                ? "Waiting for GitHub"
                : "Sign in with GitHub"}
          </button>
        </>
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
    </>
  );
}

function RegisteredDevicesSection({
  open,
  devices,
  currentDeviceId,
  busy,
  status,
  retirementTarget,
  retirementConfirmation,
  onOpen,
  onRetirementTargetChange,
  onRetirementConfirmationChange,
  onRetire,
  onClose
}: {
  open: boolean;
  devices: DeviceRecord[];
  currentDeviceId: string;
  busy: boolean;
  status: string | null;
  retirementTarget: string | null;
  retirementConfirmation: string;
  onOpen: () => void;
  onRetirementTargetChange: (deviceId: string | null) => void;
  onRetirementConfirmationChange: (value: string) => void;
  onRetire: () => void;
  onClose: () => void;
}) {
  return (
    <section className="drawer-section">
      <strong>Registered devices</strong>
      <p>Retire a lost or replaced device to revoke its relay credentials and recover a device slot.</p>
      {!open ? (
        <button className="ghost-wide" type="button" onClick={onOpen}>
          Manage registered devices
        </button>
      ) : (
        <div className="account-deletion-confirmation">
          {busy && devices.length === 0 ? <p>Loading registered devices…</p> : null}
          {!busy && devices.length === 0 ? <p>No registered devices were found for this account.</p> : null}
          {devices.map((device) => {
            const isCurrent = device.deviceId === currentDeviceId;
            return (
              <div key={device.deviceId}>
                <strong>{device.displayName || device.deviceId}</strong>
                <p>
                  <code>{device.deviceId}</code>
                  {isCurrent ? " · This device" : ` · Last seen ${new Date(device.lastSeenAt).toLocaleDateString()}`}
                </p>
                <button
                  className="ghost-wide"
                  type="button"
                  disabled={busy || isCurrent}
                  onClick={() => onRetirementTargetChange(device.deviceId)}
                >
                  {isCurrent ? "Current device" : "Retire this device"}
                </button>
              </div>
            );
          })}
          {retirementTarget && (
            <>
              <label htmlFor="registered-device-retirement-confirmation">
                Type <strong>{retirementTarget}</strong> to confirm
              </label>
              <input
                id="registered-device-retirement-confirmation"
                value={retirementConfirmation}
                onChange={(event) => onRetirementConfirmationChange(event.target.value)}
                autoComplete="off"
              />
              <button
                className="ghost-wide"
                type="button"
                disabled={busy || retirementConfirmation !== retirementTarget}
                onClick={onRetire}
              >
                {busy ? "Retiring…" : "Retire registered device"}
              </button>
              <button
                className="ghost-wide"
                type="button"
                disabled={busy}
                onClick={() => onRetirementTargetChange(null)}
              >
                Cancel
              </button>
            </>
          )}
          <button className="ghost-wide" type="button" disabled={busy} onClick={onClose}>
            Close device manager
          </button>
        </div>
      )}
      {status && (
        <div className="workflow-message" role="status">
          {status}
        </div>
      )}
    </section>
  );
}

function HostedAccountDeletionSection({
  open,
  confirmation,
  busy,
  result,
  onOpen,
  onConfirmationChange,
  onDelete,
  onCancel
}: {
  open: boolean;
  confirmation: string;
  busy: boolean;
  result: HostedAccountDeletionResult | null;
  onOpen: () => void;
  onConfirmationChange: (value: string) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="drawer-section danger-zone">
      <strong>Delete hosted account data</strong>
      <p>
        This removes your current configured relay's sign-in sessions, registered devices and KeyPackages, team
        memberships, and pending invite artifacts. It does not erase shared team or room records, MLS ciphertext and
        routing records, encrypted attachment blobs, or accepted receipts already shared with other members.
      </p>
      <p>
        You must transfer or delete teams you own and hand off rooms you host first. Local encrypted room data is
        controlled separately on this Mac; use each room's <strong>Forget on this device</strong> control to remove it.
      </p>
      {!open ? (
        <button className="ghost-wide" type="button" onClick={onOpen}>
          Delete hosted account data
        </button>
      ) : (
        <div className="account-deletion-confirmation">
          <label htmlFor="hosted-account-deletion-confirmation">
            Type <strong>{hostedAccountDeletionConfirmation}</strong> to confirm
          </label>
          <input
            id="hosted-account-deletion-confirmation"
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            autoComplete="off"
          />
          <button
            className="ghost-wide"
            type="button"
            disabled={busy || confirmation !== hostedAccountDeletionConfirmation}
            onClick={onDelete}
          >
            {busy ? "Deleting…" : "Permanently delete hosted account data"}
          </button>
          <button className="ghost-wide" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {result?.status === "blocked" && (
        <div className="workflow-message" role="status">
          Account deletion is blocked. Transfer or delete {result.blockers.ownedTeams.length} owned team(s) and hand off{" "}
          {result.blockers.hostedRooms.length} hosted room(s), then try again.
        </div>
      )}
      {result?.status === "deleted" && (
        <div className="workflow-message" role="status">
          Hosted account data deleted. This app has cleared its signed-in workspace state.
        </div>
      )}
      {result?.status === "pending" && (
        <div className="workflow-message" role="status">
          Deletion request protected and pending primary cleanup. This identity has been signed out.
        </div>
      )}
    </section>
  );
}
