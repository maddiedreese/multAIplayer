import {
  ArrowLeft,
  ArrowRight,
  Check,
  CornerDownRight,
  ExternalLink,
  Globe2,
  Maximize2,
  Minimize2,
  RotateCw,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { closeRoomBrowserSurfaceEvent } from "../lib/browser/browserSurfaceEvents";
import type { BrowserTab } from "../store/slices/browserSlice";
import { reportExpectedFailure } from "../lib/core/nonFatalReporting";
import { formatBrowserAccessLabel } from "../lib/browser/browserUi";
import {
  closeBrowserView,
  listenBrowserNavigation,
  navigateBrowserView,
  openBrowserView,
  positionBrowserView,
  readBrowserViewState,
  type BrowserNavigationEvent
} from "../lib/platform/localBackend";
import { isTauriRuntime } from "../lib/platform/localBackend/runtime";
import type { BrowserAccessRequest } from "../types";

type BrowserHistoryState = { entries: string[]; index: number };

interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type BrowserViewSession = Pick<BrowserNavigationEvent, "navigationId" | "tabId">;

const emptyBrowserHistory: BrowserHistoryState = { entries: [], index: -1 };

function recordBrowserHistoryNavigation(current: BrowserHistoryState, url: string): BrowserHistoryState {
  if (current.entries[current.index] === url) return current;
  if (current.entries[current.index - 1] === url) return { ...current, index: current.index - 1 };
  if (current.entries[current.index + 1] === url) return { ...current, index: current.index + 1 };
  const entries = current.index >= 0 ? current.entries.slice(0, current.index + 1) : [];
  return { entries: [...entries, url], index: entries.length };
}

function browserSurfaceTop(slot: HTMLElement) {
  const rect = slot.getBoundingClientRect();
  const panel = slot.parentElement;
  const toolbarBottom =
    panel?.querySelector<HTMLElement>(".browser-toolbar")?.getBoundingClientRect().bottom ?? rect.top;
  const tabsBottom = panel?.querySelector<HTMLElement>(".browser-tabs")?.getBoundingClientRect().bottom ?? rect.top;
  const requestsBottom =
    panel?.querySelector<HTMLElement>(".browser-requests")?.getBoundingClientRect().bottom ?? rect.top;
  return Math.max(rect.top, toolbarBottom, tabsBottom, requestsBottom) + 16;
}

function browserBoundsEqual(left: BrowserViewBounds, right: BrowserViewBounds | null) {
  return (
    right !== null &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function BrowserAccessPanel({
  hidden,
  roomId,
  projectPath,
  activeBrowserUrl,
  browserTabs,
  browserRequests,
  browserMessage,
  activeBrowserTabId,
  browserUrl,
  canHostBrowser,
  onBrowserUrlChange,
  onBrowserNavigation,
  onOpenBrowserNow,
  onApproveBrowserRequest,
  onDenyBrowserRequest,
  onOpenApprovedBrowserRequest,
  onSelectBrowserTab,
  onCloseBrowserTab
}: {
  hidden: boolean;
  roomId: string;
  projectPath: string;
  activeBrowserUrl: string | null;
  browserTabs: BrowserTab[];
  browserRequests: BrowserAccessRequest[];
  browserMessage: string | null;
  activeBrowserTabId: string | null;
  browserUrl: string;
  canHostBrowser: boolean;
  onBrowserUrlChange: (url: string) => void;
  onBrowserNavigation: (tabId: string, url: string) => void;
  onOpenBrowserNow: () => void;
  onApproveBrowserRequest: (request: BrowserAccessRequest) => void;
  onDenyBrowserRequest: (requestId: string) => void;
  onOpenApprovedBrowserRequest: (request: BrowserAccessRequest) => void;
  onSelectBrowserTab: (tabId: string) => void;
  onCloseBrowserTab: (tabId: string) => void;
}) {
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserWebviewOpenRef = useRef(false);
  const browserOperationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const browserNavigationListenerRef = useRef<Promise<() => void> | null>(null);
  const activeBrowserSessionRef = useRef<BrowserViewSession | null>(null);
  const observedBrowserRef = useRef<{ tabId: string; url: string } | null>(null);
  const onBrowserNavigationRef = useRef(onBrowserNavigation);
  const observeBrowserNavigationRef = useRef<(event: BrowserNavigationEvent) => void>(() => undefined);
  const lastBrowserBoundsRef = useRef<BrowserViewBounds | null>(null);
  const [browserSurfaceError, setBrowserSurfaceError] = useState<string | null>(null);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  const [browserSurfaceUrl, setBrowserSurfaceUrl] = useState(activeBrowserUrl);
  const [browserOpenRequest, setBrowserOpenRequest] = useState<{
    url: string;
    tabId: string;
    sequence: number;
  } | null>(null);
  const [browserSurfaceRevision, setBrowserSurfaceRevision] = useState(0);
  const [browserHistory, setBrowserHistory] = useState<BrowserHistoryState>(emptyBrowserHistory);
  const tauriRuntime = isTauriRuntime();
  const canOpenUrl = canHostBrowser && browserUrl.trim().length > 0;
  const canGoBack = browserHistory.index > 0;
  const canGoForward = browserHistory.index >= 0 && browserHistory.index < browserHistory.entries.length - 1;
  const panelClassName = `panel browser-panel ${hidden ? "" : "browser-open"} ${browserExpanded ? "expanded" : ""}`;

  function openBrowserUrl() {
    if (!canOpenUrl) return;
    onOpenBrowserNow();
  }

  const enqueueBrowserOperation = useCallback((operation: () => Promise<void>) => {
    const queued = browserOperationQueueRef.current
      .catch(() => reportExpectedFailure("room browser operation queue recovered from a failed operation"))
      .then(operation);
    browserOperationQueueRef.current = queued.catch(() =>
      reportExpectedFailure("room browser operation failed before the surface reached a stable state")
    );
    return queued;
  }, []);

  const closeBrowserSessionImmediately = useCallback(
    async (session: BrowserViewSession | null) => {
      if (!session || !tauriRuntime) return;
      await closeBrowserView(roomId, projectPath, session.navigationId, session.tabId).catch(() =>
        reportExpectedFailure("room browser WebView was already closed")
      );
    },
    [projectPath, roomId, tauriRuntime]
  );

  const closeBrowserWebview = useCallback(() => {
    const session = activeBrowserSessionRef.current;
    if (session && activeBrowserSessionRef.current === session) {
      activeBrowserSessionRef.current = null;
      browserWebviewOpenRef.current = false;
      lastBrowserBoundsRef.current = null;
    }
    return enqueueBrowserOperation(() => closeBrowserSessionImmediately(session));
  }, [closeBrowserSessionImmediately, enqueueBrowserOperation]);

  function navigateBrowserHistory(delta: -1 | 1) {
    const nextIndex = browserHistory.index + delta;
    const nextUrl = browserHistory.entries[nextIndex];
    if (!nextUrl) return;
    if (!tauriRuntime) {
      setBrowserHistory((current) => ({ ...current, index: nextIndex }));
      setBrowserSurfaceUrl(nextUrl);
      onBrowserUrlChange(nextUrl);
      return;
    }
    const session = activeBrowserSessionRef.current;
    if (!session) return;
    void enqueueBrowserOperation(() =>
      navigateBrowserView(roomId, projectPath, session.navigationId, session.tabId, delta < 0 ? "back" : "forward")
    ).catch((error) => {
      if (activeBrowserSessionRef.current === session)
        setBrowserSurfaceError(`Could not navigate in-app browser: ${String(error)}`);
    });
  }

  function refreshBrowserSurface() {
    if (!browserSurfaceUrl) return;
    if (tauriRuntime) {
      const session = activeBrowserSessionRef.current;
      if (!session) return;
      void enqueueBrowserOperation(() =>
        navigateBrowserView(roomId, projectPath, session.navigationId, session.tabId, "reload")
      ).catch((error) => {
        if (activeBrowserSessionRef.current === session)
          setBrowserSurfaceError(`Could not refresh in-app browser: ${String(error)}`);
      });
      return;
    }
    setBrowserSurfaceRevision((revision) => revision + 1);
  }

  function selectBrowserTab(tab: BrowserTab) {
    onSelectBrowserTab(tab.id);
    onBrowserUrlChange(tab.url);
  }

  useEffect(() => {
    onBrowserNavigationRef.current = onBrowserNavigation;
  }, [onBrowserNavigation]);

  useEffect(() => {
    if (!activeBrowserUrl) {
      observedBrowserRef.current = null;
      setBrowserSurfaceUrl(null);
      setBrowserOpenRequest(null);
      setBrowserHistory(emptyBrowserHistory);
      return;
    }
    setBrowserSurfaceUrl(activeBrowserUrl);
    if (!tauriRuntime) {
      setBrowserHistory((current) => recordBrowserHistoryNavigation(current, activeBrowserUrl));
      return;
    }
    if (!activeBrowserTabId) {
      setBrowserOpenRequest(null);
      setBrowserHistory(emptyBrowserHistory);
      return;
    }
    if (observedBrowserRef.current?.tabId === activeBrowserTabId && observedBrowserRef.current.url === activeBrowserUrl)
      return;
    setBrowserOpenRequest((current) => ({
      url: activeBrowserUrl,
      tabId: activeBrowserTabId,
      sequence: (current?.sequence ?? 0) + 1
    }));
    setBrowserHistory(emptyBrowserHistory);
  }, [activeBrowserTabId, activeBrowserUrl, tauriRuntime]);

  observeBrowserNavigationRef.current = (event) => {
    const session = activeBrowserSessionRef.current;
    if (!session || event.navigationId !== session.navigationId || event.tabId !== session.tabId) return;
    observedBrowserRef.current = { tabId: event.tabId, url: event.url };
    setBrowserSurfaceUrl(event.url);
    setBrowserHistory((current) => recordBrowserHistoryNavigation(current, event.url));
    onBrowserNavigationRef.current(event.tabId, event.url);
  };

  useEffect(() => {
    if (!tauriRuntime) return;
    let disposed = false;
    const subscription = listenBrowserNavigation((event) => {
      if (disposed || event.roomId !== roomId || (event.projectPath ?? "") !== projectPath) return;
      observeBrowserNavigationRef.current(event);
    });
    browserNavigationListenerRef.current = subscription;
    return () => {
      disposed = true;
      if (browserNavigationListenerRef.current === subscription) browserNavigationListenerRef.current = null;
      void subscription.then((stop) => stop());
    };
  }, [projectPath, roomId, tauriRuntime]);

  useEffect(() => {
    const close = () => {
      void closeBrowserWebview();
    };
    window.addEventListener(closeRoomBrowserSurfaceEvent, close);
    return () => window.removeEventListener(closeRoomBrowserSurfaceEvent, close);
  }, [closeBrowserWebview]);

  useEffect(() => {
    let cancelled = false;
    let cleanupBrowserView: (() => void) | null = null;

    function browserBounds(): BrowserViewBounds | null {
      const slot = browserViewportRef.current;
      if (!slot) return null;
      const rect = slot.getBoundingClientRect();
      const top = browserSurfaceTop(slot);
      return {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(top)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.bottom - top))
      };
    }

    async function positionBrowserWebview(session: BrowserViewSession) {
      const bounds = browserBounds();
      if (!bounds || !browserWebviewOpenRef.current) return;
      if (browserBoundsEqual(bounds, lastBrowserBoundsRef.current)) return;
      try {
        await positionBrowserView(roomId, projectPath, session.navigationId, session.tabId, bounds);
        lastBrowserBoundsRef.current = bounds;
      } catch {
        reportExpectedFailure("room browser WebView was unavailable while positioning");
      }
    }

    if (!tauriRuntime || hidden || !browserOpenRequest) {
      void closeBrowserWebview();
      return;
    }

    setBrowserSurfaceError(null);
    const navigationListener = browserNavigationListenerRef.current;
    void enqueueBrowserOperation(async () => {
      await navigationListener;
      if (cancelled || !browserViewportRef.current) return;
      const bounds = browserBounds();
      if (!bounds) return;
      const session = { navigationId: crypto.randomUUID(), tabId: browserOpenRequest.tabId };
      activeBrowserSessionRef.current = session;
      observedBrowserRef.current = null;
      setBrowserHistory(emptyBrowserHistory);
      try {
        await openBrowserView(roomId, projectPath, session.navigationId, session.tabId, browserOpenRequest.url, bounds);
        if (cancelled) return;
        browserWebviewOpenRef.current = true;
        lastBrowserBoundsRef.current = bounds;
      } catch (error) {
        if (activeBrowserSessionRef.current === session) activeBrowserSessionRef.current = null;
        if (!cancelled) setBrowserSurfaceError(`Could not open in-app browser: ${String(error)}`);
        return;
      }

      const reposition = () => {
        void positionBrowserWebview(session);
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
      let stateReadInFlight = false;
      const synchronizeUrl = async () => {
        if (stateReadInFlight || cancelled || activeBrowserSessionRef.current !== session) return;
        stateReadInFlight = true;
        try {
          const current = await readBrowserViewState(roomId, projectPath, session.navigationId, session.tabId);
          observeBrowserNavigationRef.current({ roomId, projectPath, ...current });
        } catch {
          if (!cancelled && activeBrowserSessionRef.current === session)
            reportExpectedFailure("room browser URL was temporarily unavailable");
        } finally {
          stateReadInFlight = false;
        }
      };
      void synchronizeUrl();
      const urlPoll = window.setInterval(() => void synchronizeUrl(), 250);

      cleanupBrowserView = () => {
        observer.disconnect();
        window.removeEventListener("resize", reposition);
        window.removeEventListener("scroll", reposition, true);
        window.cancelAnimationFrame(animationFrame);
        window.cancelAnimationFrame(secondAnimationFrame);
        if (nestedAnimationFrame !== null) window.cancelAnimationFrame(nestedAnimationFrame);
        window.clearInterval(urlPoll);
      };
    });

    return () => {
      cancelled = true;
      cleanupBrowserView?.();
      void closeBrowserWebview();
    };
  }, [browserOpenRequest, closeBrowserWebview, enqueueBrowserOperation, hidden, projectPath, roomId, tauriRuntime]);

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
      <BrowserRequestList
        requests={browserRequests}
        canHostBrowser={canHostBrowser}
        onApprove={onApproveBrowserRequest}
        onDeny={onDenyBrowserRequest}
        onOpen={onOpenApprovedBrowserRequest}
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
      {browserMessage && <div className="workflow-message">{browserMessage}</div>}
      {browserSurfaceError && <div className="workflow-message">{browserSurfaceError}</div>}
    </section>
  );
}

function BrowserRequestList({
  requests,
  canHostBrowser,
  onApprove,
  onDeny,
  onOpen
}: {
  requests: BrowserAccessRequest[];
  canHostBrowser: boolean;
  onApprove: (request: BrowserAccessRequest) => void;
  onDeny: (requestId: string) => void;
  onOpen: (request: BrowserAccessRequest) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <div className="browser-requests" aria-label="Browser access requests">
      {requests
        .slice(-6)
        .reverse()
        .map((request) => (
          <div className={`browser-request ${request.status}`} key={request.id}>
            <div>
              <strong>{request.url}</strong>
              <span>{request.reason}</span>
              <small>Requested by {request.requester}</small>
            </div>
            <small>{request.status}</small>
            {request.status === "pending" && (
              <div>
                <button
                  type="button"
                  onClick={() => onApprove(request)}
                  disabled={!canHostBrowser}
                  aria-label={`Approve browser access to ${formatBrowserAccessLabel(request.url)}`}
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeny(request.id)}
                  disabled={!canHostBrowser}
                  aria-label={`Deny browser access to ${formatBrowserAccessLabel(request.url)}`}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {request.status === "approved" && (
              <div>
                <button
                  type="button"
                  onClick={() => onOpen(request)}
                  disabled={!canHostBrowser}
                  aria-label={`Open approved browser page at ${formatBrowserAccessLabel(request.url)}`}
                >
                  <ExternalLink size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
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
