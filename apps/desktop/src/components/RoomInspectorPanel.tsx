import type { ReactNode } from "react";
import type { InspectorTab } from "./InspectorTabs";

export type { InspectorTab };

interface RoomInspectorPanelProps {
  activeTab: InspectorTab;
  browserPanel: ReactNode;
  filesPanel: ReactNode;
  terminalPanel: ReactNode;
  roomPanel: ReactNode;
}

export function RoomInspectorPanel({
  activeTab,
  browserPanel,
  filesPanel,
  terminalPanel,
  roomPanel
}: RoomInspectorPanelProps) {
  const activeLabel = activeTab === "room" ? "room" : activeTab;
  const panelByTab: Record<InspectorTab, ReactNode> = {
    files: filesPanel,
    diff: filesPanel,
    terminal: terminalPanel,
    browser: null,
    room: roomPanel
  };

  return (
    <aside className="inspector">
      <div className="inspector-context">
        <span>Context</span>
        <strong>{activeLabel}</strong>
      </div>

      <div
        key={activeTab}
        className={`inspector-panel-group inspector-panel-${activeTab}`}
        data-active-tab={activeTab}
      >
        {activeTab === "browser" ? browserPanel : panelByTab[activeTab]}
        {activeTab !== "browser" && browserPanel}
      </div>
    </aside>
  );
}
