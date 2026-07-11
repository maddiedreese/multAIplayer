import { useEffect, useRef, type ReactNode } from "react";

export type InspectorTab = "files" | "terminal" | "browser" | "room";

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
  const activeLabel = {
    files: "Files",
    terminal: "Terminal",
    browser: "Browser",
    room: "Room"
  } satisfies Record<InspectorTab, string>;
  const panelByTab: Record<InspectorTab, ReactNode> = {
    files: filesPanel,
    terminal: terminalPanel,
    browser: browserPanel,
    room: roomPanel
  };

  useEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector) return;
    if (typeof inspector.scrollTo === "function") {
      inspector.scrollTo({ top: 0, left: 0 });
      return;
    }
    inspector.scrollTop = 0;
    inspector.scrollLeft = 0;
  }, [activeTab]);

  return (
    <aside className="inspector" ref={inspectorRef}>
      <div className="inspector-context">
        <span>Context</span>
        <strong>{activeLabel[activeTab]}</strong>
      </div>

      <div key={activeTab} className={`inspector-panel-group inspector-panel-${activeTab}`} data-active-tab={activeTab}>
        {panelByTab[activeTab]}
      </div>
    </aside>
  );
}
