import { Settings } from "lucide-react";
import type { RoomMode } from "@multaiplayer/protocol";
import { StatusPill } from "./common";

export function RoomModePanel({
  mode,
  labels,
  disabled,
  onToggleMode
}: {
  mode: RoomMode;
  labels: Record<keyof RoomMode, string>;
  disabled: boolean;
  onToggleMode: (mode: keyof RoomMode) => void;
}) {
  return (
    <section className="panel mode-panel">
      <div className="panel-title">
        <span>Room modes</span>
        <StatusPill icon={<Settings size={13} />} label="per room" tone="dark" />
      </div>
      <div className="mode-options">
        {(Object.keys(labels) as Array<keyof RoomMode>).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={mode[key]}
              disabled={disabled}
              onChange={() => onToggleMode(key)}
            />
            <span>{labels[key]}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
