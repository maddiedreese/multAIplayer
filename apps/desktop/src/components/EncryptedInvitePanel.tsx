import { Check, Copy, RefreshCw, X } from "lucide-react";

export interface InviteRequestDisplay {
  id: string;
  requester: string;
  requesterDeviceId: string;
  note?: string;
  status: "pending" | "approved" | "denied";
}

export function EncryptedInvitePanel<T extends InviteRequestDisplay>({
  copyDisabled,
  inviteSecretInput,
  inviteRequests,
  localDeviceId,
  importDisabled,
  rotateDisabled,
  approvalDisabled,
  keyRotationBusy,
  inviteLink,
  inviteMessage,
  onCopyInvite,
  onInviteSecretInputChange,
  onImportInvite,
  onRotateRoomKey,
  onDecideInviteRequest
}: {
  copyDisabled: boolean;
  inviteSecretInput: string;
  inviteRequests: T[];
  localDeviceId: string;
  importDisabled: boolean;
  rotateDisabled: boolean;
  approvalDisabled: boolean;
  keyRotationBusy: boolean;
  inviteLink: string | null;
  inviteMessage: string | null;
  onCopyInvite: () => void;
  onInviteSecretInputChange: (value: string) => void;
  onImportInvite: () => void;
  onRotateRoomKey: () => void;
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
        Invite links do not contain the room key. The active host approves each device.
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
      <button className="ghost-wide danger" onClick={onRotateRoomKey} disabled={rotateDisabled}>
        <RefreshCw size={15} />
        {keyRotationBusy ? "Refreshing room access" : "Refresh room access"}
      </button>
      <div className="empty-state compact">
        Refreshing access updates future messages and invites for current members. It is not member removal in this
        alpha.
      </div>
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
