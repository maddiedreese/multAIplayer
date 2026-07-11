import { ArrowLeft, ArrowRight, CornerDownRight, Globe2, Maximize2, Minimize2, RotateCw, X } from "lucide-react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { closeRoomBrowserSurfaceEvent } from "../lib/browserSurfaceEvents";
import type { BrowserTab } from "../store/slices/browserSlice";

const browserWebviewLabel = "room_browser";

function browserSurfaceTop(slot: HTMLElement) {
  const rect = slot.getBoundingClientRect();
  const panel = slot.parentElement;
  const toolbarBottom =
    panel?.querySelector<HTMLElement>(".browser-toolbar")?.getBoundingClientRect().bottom ?? rect.top;
  const tabsBottom = panel?.querySelector<HTMLElement>(".browser-tabs")?.getBoundingClientRect().bottom ?? rect.top;
  return Math.max(rect.top, toolbarBottom, tabsBottom) + 16;
}

export function BrowserAccessPanel({
  hidden,
  activeBrowserUrl,
  browserTabs,
  activeBrowserTabId,
  browserUrl,
  canHostBrowser,
  onBrowserUrlChange,
  onOpenBrowserNow,
  onSelectBrowserTab,
  onCloseBrowserTab
}: {
  hidden: boolean;
  activeBrowserUrl: string | null;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserUrl: string;
  canHostBrowser: boolean;
  onBrowserUrlChange: (url: string) => void;
  onOpenBrowserNow: () => void;
  onSelectBrowserTab: (tabId: string) => void;
  onCloseBrowserTab: (tabId: string) => void;
}) {
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserWebviewRef = useRef<Webview | null>(null);
  const [browserSurfaceError, setBrowserSurfaceError] = useState<string | null>(null);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [browserSurfaceUrl, setBrowserSurfaceUrl] = useState(activeBrowserUrl);
  const [browserSurfaceRevision, setBrowserSurfaceRevision] = useState(0);
  const [browserHistory, setBrowserHistory] = useState<string[]>([]);
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(-1);
  const tauriRuntime = "__TAURI_INTERNALS__" in window;
  const canOpenUrl = canHostBrowser && browserUrl.trim().length > 0;
  const canGoBack = browserHistoryIndex > 0;
  const canGoForward = browserHistoryIndex >= 0 && browserHistoryIndex < browserHistory.length - 1;
  const panelClassName = `panel browser-panel ${hidden ? "" : "browser-open"} ${browserExpanded ? "expanded" : ""}`;

  function openBrowserUrl() {
    if (!canOpenUrl) return;
    onOpenBrowserNow();
  }

  const closeBrowserWebview = useCallback(async () => {
    const webview = browserWebviewRef.current;
    browserWebviewRef.current = null;
    if (webview) {
      await webview.close().catch(() => undefined);
    }
    if (tauriRuntime) {
      const labeledWebview = await Webview.getByLabel(browserWebviewLabel).catch(() => null);
      await labeledWebview?.close().catch(() => undefined);
    }
  }, [tauriRuntime]);

  function navigateBrowserHistory(delta: -1 | 1) {
    const nextIndex = browserHistoryIndex + delta;
    const nextUrl = browserHistory[nextIndex];
    if (!nextUrl) return;
    setBrowserHistoryIndex(nextIndex);
    setBrowserSurfaceUrl(nextUrl);
    onBrowserUrlChange(nextUrl);
  }

  function refreshBrowserSurface() {
    if (!browserSurfaceUrl) return;
    setBrowserSurfaceRevision((revision) => revision + 1);
  }

  function selectBrowserTab(tab: BrowserTab) {
    onSelectBrowserTab(tab.id);
    onBrowserUrlChange(tab.url);
  }

  useEffect(() => {
    if (!activeBrowserUrl) {
      setBrowserSurfaceUrl(null);
      setBrowserHistory([]);
      setBrowserHistoryIndex(-1);
      return;
    }
    setBrowserSurfaceUrl(activeBrowserUrl);
    setBrowserHistory((current) => {
      const existingIndex = current.indexOf(activeBrowserUrl);
      if (existingIndex >= 0) {
        setBrowserHistoryIndex(existingIndex);
        return current;
      }
      const next = browserHistoryIndex >= 0 ? current.slice(0, browserHistoryIndex + 1) : current;
      setBrowserHistoryIndex(next.length);
      return [...next, activeBrowserUrl];
    });
  }, [activeBrowserUrl, browserHistoryIndex]);

  useEffect(() => {
    const close = () => {
      void closeBrowserWebview();
    };
    window.addEventListener(closeRoomBrowserSurfaceEvent, close);
    return () => window.removeEventListener(closeRoomBrowserSurfaceEvent, close);
  }, [closeBrowserWebview]);

  useEffect(() => {
    let cancelled = false;
    let cleanupPositioning: (() => void) | null = null;

    async function positionBrowserWebview(webview: Webview) {
      const slot = browserViewportRef.current;
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      const top = browserSurfaceTop(slot);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.bottom - top));
      await webview.setPosition(new LogicalPosition(Math.round(rect.left), Math.round(top)));
      await webview.setSize(new LogicalSize(width, height));
    }

    if (!tauriRuntime || hidden || !browserSurfaceUrl) {
      void closeBrowserWebview();
      return;
    }

    setBrowserSurfaceError(null);
    void closeBrowserWebview().then(async () => {
      if (cancelled || !browserViewportRef.current) return;
      const rect = browserViewportRef.current.getBoundingClientRect();
      const top = browserSurfaceTop(browserViewportRef.current);
      const webview = new Webview(getCurrentWindow(), browserWebviewLabel, {
        url: browserSurfaceUrl,
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
      let nestedAnimationFrame: number | null = null;
      const secondAnimationFrame = window.requestAnimationFrame(() => {
        nestedAnimationFrame = window.requestAnimationFrame(reposition);
      });
      const interval = window.setInterval(reposition, 250);

      cleanupPositioning = () => {
        observer.disconnect();
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        window.cancelAnimationFrame(animationFrame);
        window.cancelAnimationFrame(secondAnimationFrame);
        if (nestedAnimationFrame !== null) window.cancelAnimationFrame(nestedAnimationFrame);
        window.clearInterval(interval);
      };
    });

    return () => {
      cancelled = true;
      cleanupPositioning?.();
      void closeBrowserWebview();
    };
  }, [browserSurfaceRevision, browserSurfaceUrl, browserExpanded, closeBrowserWebview, hidden, tauriRuntime]);

  return (
    <section className={panelClassName} hidden={hidden}>
      <BrowserToolbar
        browserUrl={browserUrl}
        browserExpanded={browserExpanded}
        browserSurfaceUrl={browserSurfaceUrl}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canHostBrowser={canHostBrowser}
        canOpenUrl={canOpenUrl}
        onBrowserUrlChange={onBrowserUrlChange}
        onNavigateHistory={navigateBrowserHistory}
        onOpenBrowserUrl={openBrowserUrl}
        onRefreshBrowserSurface={refreshBrowserSurface}
        onToggleExpanded={() => setBrowserExpanded((current) => !current)}
      />
      <BrowserTabStrip
        tabs={browserTabs}
        activeTabId={activeBrowserTabId}
        onSelectTab={selectBrowserTab}
        onCloseTab={onCloseBrowserTab}
      />
      <div className={`browser-viewport ${browserSurfaceUrl ? "active" : ""}`} ref={browserViewportRef}>
        {browserSurfaceUrl && !tauriRuntime ? (
          <iframe
            title="Room browser"
            src={browserSurfaceUrl}
            key={`${browserSurfaceUrl}:${browserSurfaceRevision}`}
            sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          />
        ) : browserSurfaceUrl ? (
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

function BrowserToolbar({
  browserUrl,
  browserExpanded,
  browserSurfaceUrl,
  canGoBack,
  canGoForward,
  canHostBrowser,
  canOpenUrl,
  onBrowserUrlChange,
  onNavigateHistory,
  onOpenBrowserUrl,
  onRefreshBrowserSurface,
  onToggleExpanded
}: {
  browserUrl: string;
  browserExpanded: boolean;
  browserSurfaceUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  canHostBrowser: boolean;
  canOpenUrl: boolean;
  onBrowserUrlChange: (url: string) => void;
  onNavigateHistory: (delta: -1 | 1) => void;
  onOpenBrowserUrl: () => void;
  onRefreshBrowserSurface: () => void;
  onToggleExpanded: () => void;
}) {
  return (
    <form
      className="browser-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        onOpenBrowserUrl();
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
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => onNavigateHistory(-1)}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={() => onNavigateHistory(1)}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          disabled={!browserSurfaceUrl}
          onClick={onRefreshBrowserSurface}
          aria-label="Refresh"
          title="Refresh"
        >
          <RotateCw size={14} />
        </button>
        <button type="button" disabled={!canOpenUrl} onClick={onOpenBrowserUrl} aria-label="Open URL" title="Open URL">
          <CornerDownRight size={14} />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={browserExpanded ? "Return browser to column" : "Expand browser"}
          title={browserExpanded ? "Return to column" : "Expand browser"}
        >
          {browserExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </form>
  );
}

function BrowserTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab
}: {
  tabs: BrowserTab[];
  activeTabId: string | null;
  onSelectTab: (tab: BrowserTab) => void;
  onCloseTab: (tabId: string) => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <div className="browser-tabs" role="tablist" aria-label="Room browser tabs">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div key={tab.id} className={`browser-tab ${active ? "active" : ""}`}>
            <button
              type="button"
              className="browser-tab-select"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectTab(tab)}
              title={tab.url}
            >
              <Globe2 size={13} />
              <span>{tab.title}</span>
            </button>
            <button
              type="button"
              className="browser-tab-close"
              onClick={() => onCloseTab(tab.id)}
              aria-label={`Close ${tab.title}`}
              title={`Close ${tab.title}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
