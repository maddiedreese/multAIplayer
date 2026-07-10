import React from "react";
import type { CodexActivity } from "../types";
import { useAppStore } from "../store/appStore";

const noActivities: CodexActivity[] = [];

export function CodexActivityTimeline({ roomId }: { roomId: string }) {
  const activities = useAppStore((state) => state.codexRuntimeByRoom[roomId]?.activities ?? noActivities);
  return <CodexActivityTimelineView activities={activities} />;
}

export function CodexActivityTimelineView({ activities }: { activities: CodexActivity[] }) {
  if (!activities.length) return null;
  const visible = activities.slice(-12).reverse();
  return (
    <section className="panel codex-activity-timeline" aria-label="Codex activity timeline">
      <header>
        <strong>Codex activity</strong>
        <span>{activities.length} item{activities.length === 1 ? "" : "s"}</span>
      </header>
      <ol aria-live="polite">
        {visible.map((activity) => (
          <li key={activity.activityId} data-status={activity.status}>
            <span className="codex-activity-marker" aria-hidden="true" />
            <div>
              <strong>{activity.title}</strong>
              <small>{formatActivityKind(activity.kind)} · {formatActivityStatus(activity.status)}</small>
            </div>
            <time dateTime={activity.updatedAt}>{formatActivityTime(activity.updatedAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatActivityKind(kind: CodexActivity["kind"]): string {
  return kind.replaceAll("_", " ");
}

function formatActivityStatus(status: CodexActivity["status"]): string {
  if (status === "running") return "in progress";
  return status;
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
