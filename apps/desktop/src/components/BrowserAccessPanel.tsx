import { Check, ExternalLink, Globe2, RefreshCw, X } from "lucide-react";
import { InlineSecretWarning } from "./common";

export interface BrowserStatusDisplay {
  profilePath: string | null;
  downloadsBlocked: boolean;
  clipboardBlocked: boolean;
  fileUploadsBlocked: boolean;
}

export interface BrowserAccessRequestDisplay {
  id: string;
  url: string;
  reason: string;
  requester: string;
  status: "pending" | "approved" | "denied";
}

export function BrowserAccessPanel<T extends BrowserAccessRequestDisplay>({
  hidden,
  browserEnabled,
  browserStatus,
  browserProfilePersistent,
  browserProfileDisabled,
  browserAllowedOriginsDraft,
  browserAllowedOriginsDisabled,
  browserUrl,
  browserReason,
  canRequestBrowser,
  canHostBrowser,
  browserRequests,
  browserMessage,
  formatBrowserAccessLabel,
  detectBrowserSecretRisks,
  onResetBrowserProfile,
  onBrowserProfilePersistenceChange,
  onBrowserAllowedOriginsDraftChange,
  onSaveBrowserAllowedOrigins,
  onBrowserUrlChange,
  onBrowserReasonChange,
  onRequestBrowserAccess,
  onApproveBrowserRequest,
  onDenyBrowserRequest,
  onOpenApprovedBrowserRequest
}: {
  hidden: boolean;
  browserEnabled: boolean;
  browserStatus: BrowserStatusDisplay;
  browserProfilePersistent: boolean;
  browserProfileDisabled: boolean;
  browserAllowedOriginsDraft: string;
  browserAllowedOriginsDisabled: boolean;
  browserUrl: string;
  browserReason: string;
  canRequestBrowser: boolean;
  canHostBrowser: boolean;
  browserRequests: T[];
  browserMessage: string | null;
  formatBrowserAccessLabel: (url: string) => string;
  detectBrowserSecretRisks: (url: string) => string[];
  onResetBrowserProfile: () => void;
  onBrowserProfilePersistenceChange: (persistent: boolean) => void;
  onBrowserAllowedOriginsDraftChange: (draft: string) => void;
  onSaveBrowserAllowedOrigins: () => void;
  onBrowserUrlChange: (url: string) => void;
  onBrowserReasonChange: (reason: string) => void;
  onRequestBrowserAccess: () => void;
  onApproveBrowserRequest: (request: T) => void;
  onDenyBrowserRequest: (requestId: string) => void;
  onOpenApprovedBrowserRequest: (request: T) => void;
}) {
  return (
    <section className="panel browser-panel" hidden={hidden}>
      <div className="panel-title">
        <span>Browser access</span>
        <small className={browserEnabled ? "panel-state available" : "panel-state"}>{browserEnabled ? "Enabled" : "Disabled"}</small>
      </div>
      <div className="browser-profile-state">
        <div>
          <strong>Room-isolated profile</strong>
          <span>
            {browserStatus.profilePath ?? "Created when the host opens an approved page."}
            {" · "}
            {browserProfilePersistent ? "persists between opens" : "refreshes before each open"}
          </span>
        </div>
        <button onClick={onResetBrowserProfile} disabled={!canHostBrowser}>
          <RefreshCw size={13} />
          Reset
        </button>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={browserProfilePersistent}
          disabled={browserProfileDisabled}
          onChange={(event) => onBrowserProfilePersistenceChange(event.target.checked)}
        />
        <span>Persist room browser profile</span>
      </label>
      <div className="browser-policy-state" aria-label="Browser safety policy">
        <span>{browserStatus.downloadsBlocked ? "Downloads blocked" : "Downloads blocked in native browser"}</span>
        <span>{browserStatus.clipboardBlocked ? "Clipboard blocked" : "Clipboard blocked in native browser"}</span>
        <span>{browserStatus.fileUploadsBlocked ? "File uploads blocked" : "File uploads blocked in native browser"}</span>
        <strong>Signed-in pages are shared with room context.</strong>
      </div>
      <div className="browser-allowlist">
        <label>
          <span>Allowed sites</span>
          <textarea
            value={browserAllowedOriginsDraft}
            disabled={browserAllowedOriginsDisabled}
            onChange={(event) => onBrowserAllowedOriginsDraftChange(event.target.value)}
            placeholder="https://github.com"
          />
        </label>
        <button
          className="ghost-wide"
          onClick={onSaveBrowserAllowedOrigins}
          disabled={browserAllowedOriginsDisabled}
        >
          <Check size={15} />
          Save allowed sites
        </button>
      </div>
      <label>
        <span>URL</span>
        <input
          value={browserUrl}
          disabled={!canRequestBrowser}
          onChange={(event) => onBrowserUrlChange(event.target.value)}
          placeholder="https://github.com/maddiedreese/multAIplayer"
        />
      </label>
      <label>
        <span>Reason</span>
        <textarea
          value={browserReason}
          disabled={!canRequestBrowser}
          onChange={(event) => onBrowserReasonChange(event.target.value)}
          placeholder="Why should Codex use this page?"
        />
      </label>
      <button
        className="primary-wide"
        onClick={onRequestBrowserAccess}
        disabled={!canRequestBrowser || !browserUrl.trim()}
      >
        <Globe2 size={15} />
        Request browser access
      </button>
      <div className="browser-requests">
        {browserRequests.slice(-4).reverse().map((request) => {
          const risks = detectBrowserSecretRisks(request.url);

          return (
            <div className={`browser-request ${request.status}`} key={request.id}>
              <div>
                <strong>{formatBrowserAccessLabel(request.url)}</strong>
                <span>{request.reason}</span>
                <small>{request.requester}</small>
              </div>
              <small>{request.status}</small>
              {request.status === "pending" && (
                <div>
                  <button onClick={() => onApproveBrowserRequest(request)} disabled={!canHostBrowser}>
                    <Check size={13} />
                  </button>
                  <button onClick={() => onDenyBrowserRequest(request.id)} disabled={!canHostBrowser}>
                    <X size={13} />
                  </button>
                </div>
              )}
              {request.status === "approved" && (
                <div>
                  <button onClick={() => onOpenApprovedBrowserRequest(request)} title="Open approved room browser" disabled={!canHostBrowser}>
                    <ExternalLink size={13} />
                  </button>
                </div>
              )}
              {risks.length > 0 && (
                <InlineSecretWarning
                  risks={risks}
                  compact
                  detail="Opening this page can expose a signed-in browser session to room context and Codex actions."
                />
              )}
            </div>
          );
        })}
        {browserRequests.length === 0 && (
          <div className="empty-state compact">No browser requests in this room.</div>
        )}
      </div>
      {browserMessage && <div className="workflow-message">{browserMessage}</div>}
    </section>
  );
}
