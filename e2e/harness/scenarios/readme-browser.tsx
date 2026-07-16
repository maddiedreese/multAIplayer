import React from "react";
import { BrowserAccessPanel } from "../../../apps/desktop/src/components/BrowserAccessPanel";

export const description = "The production room-browser panel renders its clean ready state in dark mode.";
export const mockedBoundaries = ["native room WebView"] as const;

const noop = () => undefined;

export default function ReadmeBrowserScenario() {
  return (
    <section className="readme-browser-surface" data-readme-capture aria-label="Room browser feature">
      <BrowserAccessPanel
        hidden={false}
        activeBrowserUrl={null}
        browserTabs={[]}
        activeBrowserTabId={null}
        browserUrl=""
        canHostBrowser
        onBrowserUrlChange={noop}
        onOpenBrowserNow={noop}
        onSelectBrowserTab={noop}
        onCloseBrowserTab={noop}
      />
    </section>
  );
}
