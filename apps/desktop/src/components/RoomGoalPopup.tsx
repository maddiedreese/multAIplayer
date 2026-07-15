import React, { useEffect, useState } from "react";
import { Bot, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { formatRoomGoalDuration } from "../lib/room/roomGoals";
import type { RoomGoal } from "../types";

export function RoomGoalPopup({
  goal,
  onPause,
  onResume,
  onEdit,
  onDelete
}: {
  goal: RoomGoal;
  onPause: () => void;
  onResume: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.text);

  useEffect(() => {
    setDraft(goal.text);
    setEditing(false);
  }, [goal.id, goal.text]);

  function saveEdit() {
    const next = draft.trim();
    if (!next) return;
    onEdit(next);
    setEditing(false);
  }

  return (
    <section className={`room-goal ${goal.status}`} aria-label="Room goal">
      <div className="room-goal-status">
        <Bot size={15} />
        <strong>{formatGoalStatus(goal.status)}</strong>
        <span>{formatRoomGoalDuration(goal.elapsedMs)}</span>
      </div>
      {editing ? (
        <div className="room-goal-edit">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveEdit();
              if (event.key === "Escape") setEditing(false);
            }}
            aria-label="Edit room goal"
            autoFocus
          />
          <button onClick={saveEdit}>Save</button>
        </div>
      ) : (
        <p>{goal.text}</p>
      )}
      <div className="room-goal-actions">
        {goal.status === "active" ? (
          <button onClick={onPause} title="Pause goal" aria-label="Pause goal">
            <Pause size={14} />
          </button>
        ) : (
          <button onClick={onResume} title="Resume goal" aria-label="Resume goal">
            <Play size={14} />
          </button>
        )}
        <button onClick={() => setEditing((current) => !current)} title="Edit goal" aria-label="Edit goal">
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} title="Delete goal" aria-label="Delete goal">
          <Trash2 size={14} />
        </button>
      </div>
    </section>
  );
}

function formatGoalStatus(status: RoomGoal["status"]): string {
  switch (status) {
    case "active":
      return "Goal active";
    case "paused":
      return "Goal paused";
    case "blocked":
      return "Goal blocked";
    case "usageLimited":
      return "Goal usage limited";
    case "budgetLimited":
      return "Goal budget limited";
    case "complete":
      return "Goal complete";
  }
}
