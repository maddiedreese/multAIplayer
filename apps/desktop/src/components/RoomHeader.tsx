import {
  ChevronDown,
  Copy,
  X
} from "lucide-react";

type HostStatus = "active" | "handoff" | "offline";
type RelayStatus = "open" | "connecting" | "closed" | "error";

export type HeaderModelOption = {
  id: string;
  label: string;
};

export function RoomHeader({
  teamName,
  roomName,
  relayStatus,
  onlineCount,
  hostStatus,
  hostStatusLabel,
  hostBusy,
  isActiveHost,
  roomLocked,
  hasRoom,
  selectedModel,
  modelLabel,
  modelOptions,
  settingsBusy,
  browserEnabled,
  projectLabel,
  selectedCount,
  onSetHost,
  onSelectModel,
  onCopyRoomMarkdown,
  onCopySelectedMarkdown,
  onClearSelectedMessages
}: {
  teamName: string;
  roomName: string;
  relayStatus: RelayStatus;
  onlineCount: number;
  hostStatus: HostStatus;
  hostStatusLabel: string;
  hostBusy: boolean;
  isActiveHost: boolean;
  roomLocked: boolean;
  hasRoom: boolean;
  selectedModel: string;
  modelLabel: string;
  modelOptions: readonly HeaderModelOption[];
  settingsBusy: boolean;
  browserEnabled: boolean;
  projectLabel: string;
  selectedCount: number;
  onSetHost: (status: HostStatus) => void;
  onSelectModel: (model: string) => void;
  onCopyRoomMarkdown: () => void;
  onCopySelectedMarkdown: () => void;
  onClearSelectedMessages: () => void;
}) {
  const knownModel = modelOptions.some((option) => option.id === selectedModel);
  const relayLabel = relayStatus === "open" ? "live" : relayStatus;

  return (
    <header className="room-header">
      <div className="room-heading">
        <div className="crumb">
          <span>{teamName}</span>
          <ChevronDown size={14} />
        </div>
        <h1>{roomName}</h1>
        <div className="room-subtitle">
          <span>{onlineCount || 1} member{onlineCount === 1 ? "" : "s"}</span>
          <span>{hostStatusLabel}</span>
          <span>{browserEnabled ? "browser available" : "browser off"}</span>
          <span>{projectLabel}</span>
          <span className={`relay-dot ${relayStatus}`}>{relayLabel}</span>
        </div>
      </div>
      <div className="header-actions">
        <div className="host-controls">
          <button onClick={() => onSetHost("active")} disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "active"}>
            Host
          </button>
          <button onClick={() => onSetHost("handoff")} disabled={!hasRoom || roomLocked || hostBusy || !isActiveHost}>
            Handoff
          </button>
          <button onClick={() => onSetHost("offline")} disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "offline" || !isActiveHost}>
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
        <button className="header-copy" onClick={onCopySelectedMarkdown} disabled={!hasRoom || selectedCount === 0}>
          <Copy size={14} />
          {selectedCount ? `${selectedCount} selected` : "Selected"}
        </button>
        {selectedCount > 0 && (
          <button className="header-copy" onClick={onClearSelectedMessages}>
            <X size={14} />
            Clear
          </button>
        )}
      </div>
    </header>
  );
}
