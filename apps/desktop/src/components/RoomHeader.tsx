import {
  Bot,
  ChevronDown,
  Copy,
  FolderGit2,
  Globe2,
  Lock,
  Terminal,
  UserRoundCheck,
  UsersRound,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { StatusPill } from "./common";

type HostStatus = "active" | "handoff" | "offline";
type RelayStatus = "open" | "connecting" | "closed" | "error";
type StatusTone = "green" | "blue" | "yellow" | "red" | "dark" | "muted";

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

  return (
    <header className="room-header">
      <div>
        <div className="crumb">
          <span>{teamName}</span>
          <ChevronDown size={14} />
        </div>
        <h1>{roomName}</h1>
      </div>
      <div className="header-actions">
        <StatusPill icon={<Lock size={14} />} label="E2EE" tone="green" />
        <StatusPill
          icon={relayStatus === "open" ? <Wifi size={14} /> : <WifiOff size={14} />}
          label={relayStatus === "open" ? "Relay live" : `Relay ${relayStatus}`}
          tone={relayStatus === "open" ? "green" : "yellow"}
        />
        <StatusPill icon={<UsersRound size={14} />} label={`${onlineCount || 1} online`} tone="blue" />
        <StatusPill icon={<Bot size={14} />} label={hostStatusLabel} tone={hostTone(hostStatus)} />
        <div className="host-controls">
          <button onClick={() => onSetHost("active")} disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "active"}>
            <UserRoundCheck size={14} />
            Host
          </button>
          <button onClick={() => onSetHost("handoff")} disabled={!hasRoom || roomLocked || hostBusy || !isActiveHost}>
            <UsersRound size={14} />
            Handoff
          </button>
          <button onClick={() => onSetHost("offline")} disabled={!hasRoom || roomLocked || hostBusy || hostStatus === "offline" || !isActiveHost}>
            <X size={14} />
          </button>
        </div>
        <label className="header-model-switcher" title={isActiveHost ? "Switch Codex model for this room" : "Only the active host can switch models"}>
          <Terminal size={14} />
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
        <StatusPill icon={<Globe2 size={14} />} label={browserEnabled ? "Browser on" : "Browser off"} tone={browserEnabled ? "green" : "muted"} />
        <StatusPill icon={<FolderGit2 size={14} />} label={projectLabel} tone="dark" />
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

function hostTone(status: HostStatus): StatusTone {
  if (status === "active") return "blue";
  if (status === "handoff") return "yellow";
  return "muted";
}
