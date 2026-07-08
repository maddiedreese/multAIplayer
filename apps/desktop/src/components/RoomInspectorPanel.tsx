import { useEffect, useRef, type ReactNode } from "react";
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
  const inspectorRef = useRef<HTMLElement | null>(null);
  const activeLabel = activeTab === "room" ? "room" : activeTab;
  const panelByTab: Record<InspectorTab, ReactNode> = {
    files: filesPanel,
    diff: filesPanel,
    terminal: terminalPanel,
    browser: browserPanel,
    room: roomPanel
  };

  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeTab]);

  return (
    <aside className="inspector" ref={inspectorRef}>
      <div className="inspector-context">
        <span>Context</span>
        <strong>{activeLabel}</strong>
      </div>

      <div
        key={activeTab}
        className={`inspector-panel-group inspector-panel-${activeTab}`}
        data-active-tab={activeTab}
      >
        {panelByTab[activeTab]}
      </div>
    </aside>
  );
}
