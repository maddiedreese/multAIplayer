import { Check, Lock, ShieldAlert, X } from "lucide-react";

export interface RoomNoticeDisplay {
  key: string;
  label: string;
  message: string;
  onDismiss: () => void;
}

export function RoomStatusBanners({
  notices,
  secretWarningVisible,
  lockedMessage,
  onAcknowledgeSecretWarning
}: {
  notices: RoomNoticeDisplay[];
  secretWarningVisible: boolean;
  lockedMessage: string | null;
  onAcknowledgeSecretWarning: () => void;
}) {
  return (
    <>
      {notices.length > 0 && (
        <div className="room-notice-stack">
          {notices.map((notice) => (
            <div className="room-notice" key={notice.key}>
              <strong>{notice.label}</strong>
              <span>{notice.message}</span>
              <button onClick={notice.onDismiss} aria-label={`Dismiss ${notice.label} notice`}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {secretWarningVisible && (
        <div className="warning-banner">
          <ShieldAlert size={18} />
          <span>Everyone in this room can see Codex events, terminal output, diffs, and tool logs. Secrets may be exposed.</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAcknowledgeSecretWarning();
            }}
            aria-label="Acknowledge room visibility warning"
          >
            <Check size={16} />
            <span>I understand</span>
          </button>
        </div>
      )}

      {lockedMessage && (
        <div className="warning-banner local-lock-banner">
          <Lock size={18} />
          <span>{lockedMessage}</span>
        </div>
      )}
    </>
  );
}
