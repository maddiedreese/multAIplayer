import { Check, Copy, X } from "lucide-react";

export interface InviteRequestDisplay {
  id: string;
  requester: string;
  requesterDeviceId: string;
  requesterSignatureKeyFingerprint?: string;
  note?: string;
  status: "pending" | "approved" | "denied";
}

export function EncryptedInvitePanel<T extends InviteRequestDisplay>({
  copyDisabled,
  inviteSecretInput,
  inviteRequests,
  localDeviceId,
  importDisabled,
  approvalDisabled,
  inviteLink,
  inviteMessage,
  onCopyInvite,
  onInviteSecretInputChange,
  onImportInvite,
  onDecideInviteRequest
}: {
  copyDisabled: boolean;
  inviteSecretInput: string;
  inviteRequests: T[];
  localDeviceId: string;
  importDisabled: boolean;
  approvalDisabled: boolean;
  inviteLink: string | null;
  inviteMessage: string | null;
  onCopyInvite: () => void;
  onInviteSecretInputChange: (value: string) => void;
  onImportInvite: () => void;
  onDecideInviteRequest: (request: T, status: "approved" | "denied") => void;
}) {
  return (
    <section className="panel invite-panel">
      <div className="panel-title">
        <span>Invites</span>
        <small className="panel-state available">Host approval</small>
      </div>
      <button className="primary-wide" onClick={onCopyInvite} disabled={copyDisabled}>
        <Copy size={15} />
        Copy room invite
      </button>
      <div className="empty-state compact">
        Invite links do not contain the room key, but they do contain a private single-use capability. Share them
        privately; the active host approves each device.
      </div>
      <div className="security-boundary-warning" role="note" aria-label="Unaudited cryptography warning">
        <strong>Cryptographic integration is unaudited.</strong> Treat this alpha invite flow as security-sensitive and
        independently verify the person and device before approval.
      </div>
      <label>
        <span>Join from invite</span>
        <textarea
          value={inviteSecretInput}
          onChange={(event) => onInviteSecretInputChange(event.target.value)}
          placeholder="Paste a multAIplayer invite..."
        />
      </label>
      <button className="ghost-wide" onClick={onImportInvite} disabled={importDisabled}>
        Import invite
      </button>
      <div className="terminal-requests">
        {inviteRequests
          .slice(-4)
          .reverse()
          .map((request) => (
            <div className={`terminal-request ${request.status}`} key={request.id}>
              <div>
                <strong>{request.requester}</strong>
                <span>{request.note ?? "Requesting room access."}</span>
                <small>{request.requesterDeviceId === localDeviceId ? "This device" : request.requesterDeviceId}</small>
                {request.requesterSignatureKeyFingerprint && (
                  <small>MLS signature key: {request.requesterSignatureKeyFingerprint}</small>
                )}
              </div>
              <small>{request.status}</small>
              {request.status === "pending" && (
                <div>
                  <button
                    aria-label={`Approve ${request.requester}'s invite request`}
                    onClick={() => onDecideInviteRequest(request, "approved")}
                    disabled={approvalDisabled}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    aria-label={`Deny ${request.requester}'s invite request`}
                    onClick={() => onDecideInviteRequest(request, "denied")}
                    disabled={approvalDisabled}
                  >
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
      {inviteLink && (
        <div className="invite-link" tabIndex={0} aria-label="Generated invite link">
          {inviteLink}
        </div>
      )}
      {inviteMessage && <div className="workflow-message">{inviteMessage}</div>}
    </section>
  );
}
