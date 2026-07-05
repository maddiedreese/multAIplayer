import type { RoomMode } from "@multaiplayer/protocol";

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
        <small className="panel-state">Per room</small>
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
