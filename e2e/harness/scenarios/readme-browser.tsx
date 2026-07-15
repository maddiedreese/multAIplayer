import React from "react";
import { BrowserAccessPanel } from "../../../apps/desktop/src/components/BrowserAccessPanel";

export const description = "The production room-browser panel renders an approved local preview in dark mode.";
export const mockedBoundaries = ["native room WebView", "local preview server"] as const;

const noop = () => undefined;

export default function ReadmeBrowserScenario() {
  const previewUrl = "http://127.0.0.1:1423/e2e/harness/browser-preview.html";
  return (
    <section className="readme-browser-surface" aria-label="Room browser feature">
      <BrowserAccessPanel
        hidden={false}
        activeBrowserUrl={previewUrl}
        browserTabs={[
          {
            id: "preview",
            url: previewUrl,
            title: "Northstar preview",
            openedAt: "2026-07-15T18:00:00.000Z"
          }
        ]}
        activeBrowserTabId="preview"
        browserUrl={previewUrl}
        canHostBrowser
        onBrowserUrlChange={noop}
        onOpenBrowserNow={noop}
        onSelectBrowserTab={noop}
        onCloseBrowserTab={noop}
      />
    </section>
  );
}
