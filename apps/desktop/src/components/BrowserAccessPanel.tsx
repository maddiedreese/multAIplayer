import { Check, ExternalLink, Globe2, RefreshCw, X } from "lucide-react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
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
  activeBrowserUrl,
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
  onBrowserUrlChange,
  onBrowserReasonChange,
  onOpenBrowserNow,
  onCloseBrowser,
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
  activeBrowserUrl: string | null;
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
  onBrowserUrlChange: (url: string) => void;
  onBrowserReasonChange: (reason: string) => void;
  onOpenBrowserNow: () => void;
  onCloseBrowser: () => void;
  onRequestBrowserAccess: () => void;
  onApproveBrowserRequest: (request: T) => void;
  onDenyBrowserRequest: (requestId: string) => void;
  onOpenApprovedBrowserRequest: (request: T) => void;
}) {
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserWebviewRef = useRef<Webview | null>(null);
  const [browserSurfaceError, setBrowserSurfaceError] = useState<string | null>(null);
  const tauriRuntime = "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    let cancelled = false;
    let cleanupPositioning: (() => void) | null = null;

    async function closeBrowserWebview() {
      const webview = browserWebviewRef.current;
      browserWebviewRef.current = null;
      if (webview) {
        await webview.close().catch(() => undefined);
      }
    }

    async function positionBrowserWebview(webview: Webview) {
      const slot = browserViewportRef.current;
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      await webview.setPosition(new LogicalPosition(Math.round(rect.left), Math.round(rect.top)));
      await webview.setSize(new LogicalSize(width, height));
    }

    if (!tauriRuntime || hidden || !activeBrowserUrl) {
      void closeBrowserWebview();
      return;
    }

    setBrowserSurfaceError(null);
    void closeBrowserWebview().then(async () => {
      if (cancelled || !browserViewportRef.current) return;
      const rect = browserViewportRef.current.getBoundingClientRect();
      const webview = new Webview(getCurrentWindow(), "room_browser", {
        url: activeBrowserUrl,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        focus: true,
        dragDropEnabled: false
      });

      browserWebviewRef.current = webview;
      await webview.once("tauri://error", (event) => {
        setBrowserSurfaceError(`Could not open in-app browser: ${String(event.payload)}`);
      });
      await webview.once("tauri://created", () => {
        void positionBrowserWebview(webview);
        void webview.setFocus();
      });

      const reposition = () => {
        const current = browserWebviewRef.current;
        if (current) void positionBrowserWebview(current);
      };
      const observer = new ResizeObserver(reposition);
      observer.observe(browserViewportRef.current);
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);

      cleanupPositioning = () => {
        observer.disconnect();
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
      };
    });

    return () => {
      cancelled = true;
      cleanupPositioning?.();
      void closeBrowserWebview();
    };
  }, [activeBrowserUrl, hidden, tauriRuntime]);

  if (activeBrowserUrl) {
    return (
      <section className="panel browser-panel browser-open" hidden={hidden}>
        <div className="browser-chrome">
          <div>
            <strong>{formatBrowserAccessLabel(activeBrowserUrl)}</strong>
            <span>Room browser context</span>
          </div>
          <button onClick={onCloseBrowser} aria-label="Close room browser" title="Close room browser">
            <X size={15} />
          </button>
        </div>
        <div className="browser-viewport active" ref={browserViewportRef}>
          {!tauriRuntime ? (
            <iframe
              title="Room browser"
              src={activeBrowserUrl}
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
            />
          ) : (
            <div>
              <Globe2 size={18} />
              <strong>Browser open</strong>
              <span>The page is active in this in-app browser surface.</span>
            </div>
          )}
        </div>
        {browserSurfaceError && <div className="workflow-message browser-overlay-message">{browserSurfaceError}</div>}
        {browserMessage && <div className="workflow-message browser-overlay-message">{browserMessage}</div>}
      </section>
    );
  }

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
        <span>{browserStatus.downloadsBlocked ? "Downloads blocked where supported" : "Downloads stay on this device"}</span>
        <span>{browserStatus.clipboardBlocked ? "Clipboard blocked where supported" : "Clipboard follows browser permissions"}</span>
        <span>{browserStatus.fileUploadsBlocked ? "File uploads blocked where supported" : "File uploads need host care"}</span>
        <strong>Signed-in pages are shared with room context.</strong>
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
        onClick={onOpenBrowserNow}
        disabled={!canHostBrowser || !browserUrl.trim()}
      >
        <ExternalLink size={15} />
        Open browser
      </button>
      <button
        className="ghost-wide"
        onClick={onRequestBrowserAccess}
        disabled={!canRequestBrowser || !browserUrl.trim()}
      >
        <Globe2 size={15} />
        Request browser access
      </button>
      <div className={`browser-viewport ${activeBrowserUrl ? "active" : ""}`} ref={browserViewportRef}>
        {activeBrowserUrl && !tauriRuntime ? (
          <iframe
            title="Room browser"
            src={activeBrowserUrl}
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          />
        ) : activeBrowserUrl ? (
          <div>
            <Globe2 size={18} />
            <strong>Browser open</strong>
            <span>The page is active in this in-app browser surface.</span>
          </div>
        ) : (
          <div>
            <Globe2 size={18} />
            <strong>No page open</strong>
            <span>Open an approved URL to browse inside this room.</span>
          </div>
        )}
      </div>
      {browserSurfaceError && <div className="workflow-message">{browserSurfaceError}</div>}
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
