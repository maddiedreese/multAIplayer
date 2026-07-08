import type { ReactNode } from "react";
import type { InspectorTab } from "./InspectorTabs";

export type { InspectorTab };

interface RoomInspectorPanelProps {
  activeTab: InspectorTab;
  browserPanel: ReactNode;
  workPanel: ReactNode;
}

export function RoomInspectorPanel({
  activeTab,
  browserPanel,
  workPanel
}: RoomInspectorPanelProps) {
  const activeLabel = activeTab === "room" ? "room" : activeTab;
  const panel = activeTab === "browser" ? browserPanel : workPanel;

  return (
    <aside className="inspector">
      <div className="inspector-context">
        <span>Context</span>
        <strong>{activeLabel}</strong>
      </div>

      <div
        className={`inspector-panel-group inspector-panel-${activeTab}`}
        data-active-tab={activeTab}
      >
        {panel}
      </div>
    </aside>
  );
}
