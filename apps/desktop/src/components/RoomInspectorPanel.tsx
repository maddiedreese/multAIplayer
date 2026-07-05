import type { ReactNode } from "react";
import { InspectorTabs, type InspectorTab } from "./InspectorTabs";

export type { InspectorTab };

interface RoomInspectorPanelProps {
  activeTab: InspectorTab;
  diffAttentionCount: number;
  terminalAttentionCount: number;
  browserAttentionCount: number;
  roomAttentionCount: number;
  browserPanel: ReactNode;
  workPanel: ReactNode;
  onSelectTab: (tab: InspectorTab) => void;
}

export function RoomInspectorPanel({
  activeTab,
  diffAttentionCount,
  terminalAttentionCount,
  browserAttentionCount,
  roomAttentionCount,
  browserPanel,
  workPanel,
  onSelectTab
}: RoomInspectorPanelProps) {
  return (
    <aside className="inspector">
      <InspectorTabs
        activeTab={activeTab}
        diffAttentionCount={diffAttentionCount}
        terminalAttentionCount={terminalAttentionCount}
        browserAttentionCount={browserAttentionCount}
        roomAttentionCount={roomAttentionCount}
        onSelectTab={onSelectTab}
      />

      <div className="inspector-panel-group" hidden={activeTab !== "browser"}>{browserPanel}</div>
      <div
        className={`inspector-panel-group inspector-panel-${activeTab}`}
        hidden={activeTab === "browser"}
      >
        {workPanel}
      </div>
    </aside>
  );
}
