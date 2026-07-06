import {
  ChevronDown,
  Copy,
  FileText,
  Globe2,
  Terminal,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { InspectorTab } from "./InspectorTabs";

type HostStatus = "active" | "handoff" | "offline";

export type HeaderModelOption = {
  id: string;
  label: string;
};

export function RoomHeader({
  teams,
  selectedTeamId,
  roomName,
  hostStatus,
  hostBusy,
  isActiveHost,
  roomLocked,
  hasRoom,
  selectedModel,
  modelLabel,
  modelOptions,
  settingsBusy,
  selectedCount,
  markdownSelectionMode,
  activeInspectorTab,
  onSetHost,
  onSelectTeam,
  onRenameRoom,
  onSelectModel,
  onSelectInspectorTab,
  onCopyRoomMarkdown,
  onCopySelectedMarkdown,
  onToggleMarkdownSelection,
  onClearSelectedMessages
}: {
  teams: Array<{ id: string; name: string }>;
  selectedTeamId: string;
  roomName: string;
  hostStatus: HostStatus;
  hostBusy: boolean;
  isActiveHost: boolean;
  roomLocked: boolean;
  hasRoom: boolean;
  selectedModel: string;
  modelLabel: string;
  modelOptions: readonly HeaderModelOption[];
  settingsBusy: boolean;
  selectedCount: number;
  markdownSelectionMode: boolean;
  activeInspectorTab: InspectorTab;
  onSetHost: (status: HostStatus) => void;
  onSelectTeam: (teamId: string) => void;
  onRenameRoom: (name: string) => void;
  onSelectModel: (model: string) => void;
  onSelectInspectorTab: (tab: InspectorTab) => void;
  onCopyRoomMarkdown: () => void;
  onCopySelectedMarkdown: () => void;
  onToggleMarkdownSelection: () => void;
  onClearSelectedMessages: () => void;
}) {
  const knownModel = modelOptions.some((option) => option.id === selectedModel);
  const [roomNameDraft, setRoomNameDraft] = useState(roomName);
  useEffect(() => setRoomNameDraft(roomName), [roomName]);
  const commitRoomName = () => {
    const nextName = roomNameDraft.trim();
    if (nextName && nextName !== roomName) onRenameRoom(nextName);
    else setRoomNameDraft(roomName);
  };
  const toolTabs: Array<{ id: InspectorTab; label: string; icon: ReactNode }> = [
    { id: "files", label: "files", icon: <FileText size={16} /> },
    { id: "terminal", label: "terminal", icon: <Terminal size={16} /> },
    { id: "browser", label: "browser", icon: <Globe2 size={16} /> },
    { id: "room", label: "room", icon: <UsersRound size={16} /> }
  ];

  return (
    <header className="room-header">
      <div className="room-heading">
        <div className="crumb">
          <select
            aria-label="Switch team"
            value={selectedTeamId}
            disabled={!hasRoom}
            onChange={(event) => onSelectTeam(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
        <input
          className="room-title-input"
          aria-label="Room title"
          value={roomNameDraft}
          disabled={!hasRoom || roomLocked || settingsBusy}
          onChange={(event) => setRoomNameDraft(event.target.value)}
          onBlur={commitRoomName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setRoomNameDraft(roomName);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <nav className="room-tool-nav" aria-label="Room tools">
        {toolTabs.map((tab) => (
          <button
            className={activeInspectorTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => onSelectInspectorTab(tab.id)}
            aria-pressed={activeInspectorTab === tab.id}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <div className="host-controls">
          <button onClick={() => onSetHost("active")} disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "active"}>
            Host
          </button>
          <button onClick={() => onSetHost("handoff")} disabled={!hasRoom || roomLocked || hostBusy || !isActiveHost}>
            Handoff
          </button>
          <button
            onClick={() => onSetHost("offline")}
            disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "offline" || !isActiveHost}
            title="Stop hosting this room"
            aria-label="Stop hosting this room"
          >
            <X size={14} />
          </button>
        </div>
        <label className="header-model-switcher" title={isActiveHost ? "Switch Codex model for this room" : "Only the active host can switch models"}>
          <select
            aria-label="Codex host model"
            value={knownModel ? selectedModel : "custom"}
            disabled={!hasRoom || roomLocked || settingsBusy || !isActiveHost}
            onChange={(event) => {
              if (event.target.value !== "custom") {
                onSelectModel(event.target.value);
              }
            }}
          >
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            {!knownModel && <option value="custom">{modelLabel}</option>}
          </select>
        </label>
        <button className="header-copy" onClick={onCopyRoomMarkdown} disabled={!hasRoom}>
          <Copy size={14} />
          Markdown
        </button>
        <button
          className={markdownSelectionMode ? "header-copy active" : "header-copy"}
          onClick={() => {
            if (markdownSelectionMode && selectedCount > 0) {
              onCopySelectedMarkdown();
            } else {
              onToggleMarkdownSelection();
            }
          }}
          disabled={!hasRoom}
        >
          <Copy size={14} />
          {markdownSelectionMode
            ? selectedCount
              ? `Copy ${selectedCount}`
              : "Select messages"
            : "Selected"}
        </button>
        {markdownSelectionMode && (
          <button className="header-copy" onClick={selectedCount > 0 ? onClearSelectedMessages : onToggleMarkdownSelection}>
            <X size={14} />
            {selectedCount > 0 ? "Clear" : "Done"}
          </button>
        )}
      </div>
    </header>
  );
}
