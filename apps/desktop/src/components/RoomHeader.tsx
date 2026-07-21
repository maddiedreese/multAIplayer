import { ChevronDown, ChevronUp, Copy, FileText, Globe2, MonitorUp, Terminal, UsersRound, X } from "lucide-react";
import React, { useEffect, useState, type ReactNode } from "react";
import type { InspectorTab } from "../lib/core/uiTypes";
import { closeRoomBrowserSurface } from "../lib/browser/browserSurfaceEvents";

type HostStatus = "active" | "offline";
type HostAction = "active" | "handoff";
const roomToolTabs: Array<{ id: InspectorTab; label: string; icon: ReactNode }> = [
  { id: "files", label: "Files", icon: <FileText size={16} /> },
  { id: "terminal", label: "Terminal", icon: <Terminal size={16} /> },
  { id: "browser", label: "Browser", icon: <Globe2 size={16} /> },
  { id: "room", label: "Room", icon: <UsersRound size={16} /> }
];

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
  selectedReasoningEffort,
  reasoningLabel,
  reasoningOptions,
  selectedSpeed,
  speedLabel,
  speedOptions,
  settingsBusy,
  selectedCount,
  markdownSelectionMode,
  activeInspectorTab,
  onSetHost,
  onSelectTeam,
  onRenameRoom,
  onSelectModel,
  onSelectReasoningEffort,
  onSelectSpeed,
  onSelectInspectorTab,
  onCopyRoomMarkdown,
  onCopySelectedMarkdown,
  onToggleMarkdownSelection,
  onClearSelectedMessages,
  onShareLocalPreview
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
  selectedReasoningEffort: string;
  reasoningLabel: string;
  reasoningOptions: readonly HeaderModelOption[];
  selectedSpeed: string;
  speedLabel: string;
  speedOptions: readonly HeaderModelOption[];
  settingsBusy: boolean;
  selectedCount: number;
  markdownSelectionMode: boolean;
  activeInspectorTab: InspectorTab;
  onSetHost: (action: HostAction) => void;
  onSelectTeam: (teamId: string) => void;
  onRenameRoom: (name: string) => void;
  onSelectModel: (model: string) => void;
  onSelectReasoningEffort: (effort: string) => void;
  onSelectSpeed: (speed: string) => void;
  onSelectInspectorTab: (tab: InspectorTab) => void;
  onCopyRoomMarkdown: () => void;
  onCopySelectedMarkdown: () => void;
  onToggleMarkdownSelection: () => void;
  onClearSelectedMessages: () => void;
  onShareLocalPreview: () => void;
}) {
  const [roomNameDraft, setRoomNameDraft] = useState(roomName);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  useEffect(() => setRoomNameDraft(roomName), [roomName]);
  const commitRoomName = () => {
    const nextName = roomNameDraft.trim();
    if (nextName && nextName !== roomName) onRenameRoom(nextName);
    else setRoomNameDraft(roomName);
  };
  return (
    <header className="room-header" data-controls-collapsed={controlsCollapsed}>
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
        <button
          type="button"
          className="room-controls-toggle"
          aria-expanded={!controlsCollapsed}
          aria-label={controlsCollapsed ? "Expand room controls" : "Collapse room controls"}
          title={controlsCollapsed ? "Expand room controls" : "Collapse room controls"}
          onClick={() => setControlsCollapsed((collapsed) => !collapsed)}
        >
          {controlsCollapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      </div>
      {!controlsCollapsed && (
        <>
          <RoomToolNav activeTab={activeInspectorTab} onSelect={onSelectInspectorTab} />
          <div className="header-actions">
            <div className="host-controls">
              <button
                onClick={() => onSetHost("active")}
                disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "active"}
              >
                Host
              </button>
              <button
                onClick={() => onSetHost("handoff")}
                disabled={!hasRoom || roomLocked || hostBusy || !isActiveHost}
              >
                Handoff
              </button>
            </div>
            <CodexHeaderSelectors
              {...{
                hasRoom,
                roomLocked,
                settingsBusy,
                isActiveHost,
                selectedModel,
                modelLabel,
                modelOptions,
                selectedReasoningEffort,
                reasoningLabel,
                reasoningOptions,
                selectedSpeed,
                speedLabel,
                speedOptions,
                onSelectModel,
                onSelectReasoningEffort,
                onSelectSpeed
              }}
            />
            <HeaderMarkdownActions
              hasRoom={hasRoom}
              roomLocked={roomLocked}
              selectionMode={markdownSelectionMode}
              selectedCount={selectedCount}
              onCopyRoom={onCopyRoomMarkdown}
              onSharePreview={onShareLocalPreview}
              onCopySelected={onCopySelectedMarkdown}
              onToggleSelection={onToggleMarkdownSelection}
              onClearSelection={onClearSelectedMessages}
            />
          </div>
        </>
      )}
    </header>
  );
}

function CodexHeaderSelectors(
  props: Pick<
    Parameters<typeof RoomHeader>[0],
    | "hasRoom"
    | "roomLocked"
    | "settingsBusy"
    | "isActiveHost"
    | "selectedModel"
    | "modelLabel"
    | "modelOptions"
    | "selectedReasoningEffort"
    | "reasoningLabel"
    | "reasoningOptions"
    | "selectedSpeed"
    | "speedLabel"
    | "speedOptions"
    | "onSelectModel"
    | "onSelectReasoningEffort"
    | "onSelectSpeed"
  >
) {
  const disabled = !props.hasRoom || props.roomLocked || props.settingsBusy || !props.isActiveHost;
  return (
    <>
      <HeaderSelector
        label="Codex host model"
        value={props.selectedModel}
        fallbackValue={props.selectedModel}
        fallbackLabel={props.modelLabel}
        options={props.modelOptions}
        disabled={disabled}
        onChange={props.onSelectModel}
      />
      <HeaderSelector
        label="Codex reasoning"
        value={props.selectedReasoningEffort}
        fallbackValue="medium"
        fallbackLabel={props.reasoningLabel}
        options={props.reasoningOptions}
        disabled={disabled}
        onChange={props.onSelectReasoningEffort}
      />
      <HeaderSelector
        label="Codex speed"
        value={props.selectedSpeed}
        fallbackValue="standard"
        fallbackLabel={props.speedLabel}
        options={props.speedOptions}
        disabled={disabled}
        onChange={props.onSelectSpeed}
      />
    </>
  );
}

function HeaderSelector({
  label,
  value,
  fallbackValue,
  fallbackLabel,
  options,
  disabled,
  onChange
}: {
  label: string;
  value: string;
  fallbackValue: string;
  fallbackLabel: string;
  options: readonly HeaderModelOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const known = options.some((option) => option.id === value);
  return (
    <label className="header-model-switcher">
      <select
        aria-label={label}
        value={known ? value : fallbackValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        {!known && <option value={value}>{fallbackLabel}</option>}
      </select>
    </label>
  );
}

function HeaderMarkdownActions({
  hasRoom,
  roomLocked,
  selectionMode,
  selectedCount,
  onCopyRoom,
  onSharePreview,
  onCopySelected,
  onToggleSelection,
  onClearSelection
}: {
  hasRoom: boolean;
  roomLocked: boolean;
  selectionMode: boolean;
  selectedCount: number;
  onCopyRoom: () => void;
  onSharePreview: () => void;
  onCopySelected: () => void;
  onToggleSelection: () => void;
  onClearSelection: () => void;
}) {
  const copySelected = () => {
    if (selectionMode && selectedCount > 0) onCopySelected();
    else onToggleSelection();
  };
  return (
    <>
      <button className="header-copy" onClick={onCopyRoom} disabled={!hasRoom}>
        <Copy size={14} /> Markdown
      </button>
      <button className="header-copy" onClick={onSharePreview} disabled={!hasRoom || roomLocked}>
        <MonitorUp size={14} /> Share local preview
      </button>
      <button
        className={selectionMode ? "header-copy active" : "header-copy"}
        onClick={copySelected}
        disabled={!hasRoom}
      >
        <Copy size={14} />
        {selectionMode ? (selectedCount ? `Copy ${selectedCount}` : "Select messages") : "Selected"}
      </button>
      {selectionMode && (
        <button className="header-copy" onClick={selectedCount > 0 ? onClearSelection : onToggleSelection}>
          <X size={14} /> {selectedCount > 0 ? "Clear" : "Done"}
        </button>
      )}
    </>
  );
}

function RoomToolNav({ activeTab, onSelect }: { activeTab: InspectorTab; onSelect: (tab: InspectorTab) => void }) {
  return (
    <nav className="room-tool-nav" aria-label="Room tools">
      {roomToolTabs.map((tab) => (
        <button
          className={activeTab === tab.id ? "active" : ""}
          key={tab.id}
          onClick={() => {
            if (tab.id !== "browser") closeRoomBrowserSurface();
            onSelect(tab.id);
          }}
          aria-pressed={activeTab === tab.id}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
