import { ArrowRight, Globe2, Maximize2, Minimize2 } from "lucide-react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

export function BrowserAccessPanel({
  hidden,
  activeBrowserUrl,
  browserUrl,
  canHostBrowser,
  onBrowserUrlChange,
  onOpenBrowserNow
}: {
  hidden: boolean;
  activeBrowserUrl: string | null;
  browserUrl: string;
  canHostBrowser: boolean;
  onBrowserUrlChange: (url: string) => void;
  onOpenBrowserNow: () => void;
}) {
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserWebviewRef = useRef<Webview | null>(null);
  const [browserSurfaceError, setBrowserSurfaceError] = useState<string | null>(null);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const tauriRuntime = "__TAURI_INTERNALS__" in window;
  const canOpenUrl = canHostBrowser && browserUrl.trim().length > 0;

  function openBrowserUrl() {
    if (!canOpenUrl) return;
    onOpenBrowserNow();
  }

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
      const toolbar = slot.parentElement?.querySelector<HTMLElement>(".browser-toolbar");
      const toolbarRect = toolbar?.getBoundingClientRect();
      const top = toolbarRect ? Math.max(rect.top, toolbarRect.bottom + 18) : rect.top;
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.bottom - top));
      await webview.setPosition(new LogicalPosition(Math.round(rect.left), Math.round(top)));
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
      const toolbar = browserViewportRef.current.parentElement?.querySelector<HTMLElement>(".browser-toolbar");
      const toolbarRect = toolbar?.getBoundingClientRect();
      const top = toolbarRect ? Math.max(rect.top, toolbarRect.bottom + 18) : rect.top;
      const webview = new Webview(getCurrentWindow(), "room_browser", {
        url: activeBrowserUrl,
        x: Math.round(rect.left),
        y: Math.round(top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.bottom - top)),
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
      const animationFrame = window.requestAnimationFrame(reposition);
      const secondAnimationFrame = window.requestAnimationFrame(() => window.requestAnimationFrame(reposition));
      const interval = window.setInterval(reposition, 250);

      cleanupPositioning = () => {
        observer.disconnect();
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        window.cancelAnimationFrame(animationFrame);
        window.cancelAnimationFrame(secondAnimationFrame);
        window.clearInterval(interval);
      };
    });

    return () => {
      cancelled = true;
      cleanupPositioning?.();
      void closeBrowserWebview();
    };
  }, [activeBrowserUrl, browserExpanded, hidden, tauriRuntime]);

  if (activeBrowserUrl) {
    return (
      <section className={`panel browser-panel browser-open ${browserExpanded ? "expanded" : ""}`} hidden={hidden}>
        <form
          className="browser-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            openBrowserUrl();
          }}
        >
          <Globe2 size={15} />
          <input
            value={browserUrl}
            disabled={!canHostBrowser}
            onChange={(event) => onBrowserUrlChange(event.target.value)}
            placeholder="Search or enter URL"
            aria-label="Browser URL"
          />
          <div className="browser-toolbar-actions">
            <button type="button" disabled={!canOpenUrl} onClick={openBrowserUrl} aria-label="Open URL" title="Open URL">
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => setBrowserExpanded((current) => !current)}
              aria-label={browserExpanded ? "Return browser to column" : "Expand browser"}
              title={browserExpanded ? "Return to column" : "Expand browser"}
            >
              {browserExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </form>
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
        {browserSurfaceError && <div className="workflow-message">{browserSurfaceError}</div>}
      </section>
    );
  }

  return (
    <section className={`panel browser-panel browser-open ${browserExpanded ? "expanded" : ""}`} hidden={hidden}>
      <form
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          openBrowserUrl();
        }}
      >
        <Globe2 size={15} />
        <input
          value={browserUrl}
          disabled={!canHostBrowser}
          onChange={(event) => onBrowserUrlChange(event.target.value)}
          placeholder="Search or enter URL"
          aria-label="Browser URL"
        />
        <div className="browser-toolbar-actions">
          <button type="button" disabled={!canOpenUrl} onClick={openBrowserUrl} aria-label="Open URL" title="Open URL">
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => setBrowserExpanded((current) => !current)}
            aria-label={browserExpanded ? "Return browser to column" : "Expand browser"}
            title={browserExpanded ? "Return to column" : "Expand browser"}
          >
            {browserExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </form>
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
            <span>Enter a URL above to browse inside this room.</span>
          </div>
        )}
      </div>
      {browserSurfaceError && <div className="workflow-message">{browserSurfaceError}</div>}
    </section>
  );
}
