import type { ReactNode } from "react";
import { InspectorTabs, type InspectorTab } from "./InspectorTabs";

export type { InspectorTab };

interface RoomInspectorPanelProps {
  activeTab: InspectorTab;
  workAttentionCount: number;
  browserAttentionCount: number;
  browserPanel: ReactNode;
  workPanel: ReactNode;
  onSelectTab: (tab: InspectorTab) => void;
}

export function RoomInspectorPanel({
  activeTab,
  workAttentionCount,
  browserAttentionCount,
  browserPanel,
  workPanel,
  onSelectTab
}: RoomInspectorPanelProps) {
  return (
    <aside className="inspector">
      <InspectorTabs
        activeTab={activeTab}
        workAttentionCount={workAttentionCount}
        browserAttentionCount={browserAttentionCount}
        onSelectTab={onSelectTab}
      />

      <div hidden={activeTab !== "browser"}>{browserPanel}</div>

      <div className="inspector-panel-group" hidden={activeTab !== "work"}>
        {workPanel}
      </div>
    </aside>
  );
}
