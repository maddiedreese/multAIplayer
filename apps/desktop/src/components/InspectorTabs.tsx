import { FileText, Globe2, Terminal, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

export type InspectorTab = "files" | "diff" | "terminal" | "browser" | "room";

export function InspectorTabs({
  activeTab,
  diffAttentionCount,
  terminalAttentionCount,
  browserAttentionCount,
  roomAttentionCount,
  onSelectTab
}: {
  activeTab: InspectorTab;
  diffAttentionCount: number;
  terminalAttentionCount: number;
  browserAttentionCount: number;
  roomAttentionCount: number;
  onSelectTab: (tab: InspectorTab) => void;
}) {
  const tabs: Array<{
    id: InspectorTab;
    label: string;
    icon: ReactNode;
    count: number;
  }> = [
    { id: "files", label: "files", icon: <FileText size={15} />, count: diffAttentionCount },
    { id: "terminal", label: "terminal", icon: <Terminal size={15} />, count: terminalAttentionCount },
    { id: "browser", label: "browser", icon: <Globe2 size={15} />, count: browserAttentionCount },
    { id: "room", label: "room", icon: <UsersRound size={15} />, count: roomAttentionCount }
  ];

  return (
    <div className="inspector-tabs">
      {tabs.map((tab) => (
        <button
          className={activeTab === tab.id ? "active" : ""}
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          aria-pressed={activeTab === tab.id}
        >
          {tab.icon} {tab.label}
          {tab.count > 0 && <span className="tab-badge">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
