import { Check, Copy, KeyRound, Lock, RefreshCw, X } from "lucide-react";
import { StatusPill } from "./common";

export interface InviteRequestDisplay {
  id: string;
  requester: string;
  requesterDeviceId: string;
  note?: string;
  status: "pending" | "approved" | "denied";
}

export function EncryptedInvitePanel<T extends InviteRequestDisplay>({
  inviteApprovalGate,
  copyDisabled,
  inviteSecretInput,
  inviteRequests,
  localDeviceId,
  gateDisabled,
  importDisabled,
  rotateDisabled,
  approvalDisabled,
  keyRotationBusy,
  inviteLink,
  inviteMessage,
  onCopyInvite,
  onInviteApprovalGateChange,
  onInviteSecretInputChange,
  onImportInvite,
  onRotateRoomKey,
  onDecideInviteRequest
}: {
  inviteApprovalGate: boolean;
  copyDisabled: boolean;
  inviteSecretInput: string;
  inviteRequests: T[];
  localDeviceId: string;
  gateDisabled: boolean;
  importDisabled: boolean;
  rotateDisabled: boolean;
  approvalDisabled: boolean;
  keyRotationBusy: boolean;
  inviteLink: string | null;
  inviteMessage: string | null;
  onCopyInvite: () => void;
  onInviteApprovalGateChange: (enabled: boolean) => void;
  onInviteSecretInputChange: (value: string) => void;
  onImportInvite: () => void;
  onRotateRoomKey: () => void;
  onDecideInviteRequest: (request: T, status: "approved" | "denied") => void;
}) {
  return (
    <section className="panel invite-panel">
      <div className="panel-title">
        <span>Encrypted invite</span>
        <StatusPill
          icon={<Lock size={13} />}
          label={inviteApprovalGate ? "approval key delivery" : "fragment key"}
          tone={inviteApprovalGate ? "blue" : "green"}
        />
      </div>
      <button className="primary-wide" onClick={onCopyInvite} disabled={copyDisabled}>
        <Copy size={15} />
        Copy room invite
      </button>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={inviteApprovalGate}
          disabled={gateDisabled}
          onChange={(event) => onInviteApprovalGateChange(event.target.checked)}
        />
        <span>Ask host to approve joiners</span>
      </label>
      <label>
        <span>Join from invite link or key</span>
        <textarea
          value={inviteSecretInput}
          onChange={(event) => onInviteSecretInputChange(event.target.value)}
          placeholder="Paste a multAIplayer invite..."
        />
      </label>
      <button className="ghost-wide" onClick={onImportInvite} disabled={importDisabled}>
        <KeyRound size={15} />
        Import invite
      </button>
      <button className="ghost-wide danger" onClick={onRotateRoomKey} disabled={rotateDisabled}>
        <RefreshCw size={15} />
        {keyRotationBusy ? "Rotating room key" : "Rotate room key"}
      </button>
      <div className="empty-state compact">
        Rotation updates future messages and invites for current key holders. It is not alpha member removal.
      </div>
      <div className="terminal-requests">
        {inviteRequests.slice(-4).reverse().map((request) => (
          <div className={`terminal-request ${request.status}`} key={request.id}>
            <div>
              <strong>{request.requester}</strong>
              <span>{request.note ?? "Requesting room access."}</span>
              <small>{request.requesterDeviceId === localDeviceId ? "This device" : request.requesterDeviceId}</small>
            </div>
            <small>{request.status}</small>
            {request.status === "pending" && (
              <div>
                <button onClick={() => onDecideInviteRequest(request, "approved")} disabled={approvalDisabled}>
                  <Check size={13} />
                </button>
                <button onClick={() => onDecideInviteRequest(request, "denied")} disabled={approvalDisabled}>
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
        {inviteRequests.length === 0 && (
          <div className="empty-state compact">No invite approval requests in this room.</div>
        )}
      </div>
      {inviteLink && <div className="invite-link">{inviteLink}</div>}
      {inviteMessage && <div className="workflow-message">{inviteMessage}</div>}
    </section>
  );
}
