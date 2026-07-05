import { Globe2, PanelRight } from "lucide-react";

export type InspectorTab = "work" | "browser";

export function InspectorTabs({
  activeTab,
  workAttentionCount,
  browserAttentionCount,
  onSelectTab
}: {
  activeTab: InspectorTab;
  workAttentionCount: number;
  browserAttentionCount: number;
  onSelectTab: (tab: InspectorTab) => void;
}) {
  return (
    <div className="inspector-tabs">
      <button
        className={activeTab === "work" ? "active" : ""}
        onClick={() => onSelectTab("work")}
        aria-pressed={activeTab === "work"}
      >
        <PanelRight size={15} /> Work
        {workAttentionCount > 0 && <span className="tab-badge">{workAttentionCount}</span>}
      </button>
      <button
        className={activeTab === "browser" ? "active" : ""}
        onClick={() => onSelectTab("browser")}
        aria-pressed={activeTab === "browser"}
      >
        <Globe2 size={15} /> Browser
        {browserAttentionCount > 0 && <span className="tab-badge">{browserAttentionCount}</span>}
      </button>
    </div>
  );
}
