import React from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  FilePenLine,
  Image,
  Search,
  TerminalSquare,
  Wrench
} from "lucide-react";
import type { CodexActivity } from "../types";

export function CodexActivityFeed({ activities }: { activities: readonly CodexActivity[] }) {
  if (!activities.length) return null;
  const visible = activities.slice(-24);
  const running = visible.some((activity) => activity.status === "started" || activity.status === "running");
  return (
    <section className="codex-work-feed" aria-label="Codex work">
      <details open={running || undefined}>
        <summary>
          {running ? <CircleEllipsis size={15} /> : <CheckCircle2 size={15} />}
          <strong>{running ? "Codex is working" : "Codex worked"}</strong>
          <span>
            {visible.length} step{visible.length === 1 ? "" : "s"}
          </span>
          <ChevronRight className="codex-disclosure-chevron" size={14} aria-hidden="true" />
        </summary>
        <ol aria-live="polite">
          {visible.map((activity) => (
            <li key={activity.activityId}>
              <CodexActivityDisclosure activity={activity} />
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

export function CodexActivityDisclosure({ activity }: { activity: CodexActivity }) {
  const label = activityLabel(activity);
  const hasDetails = Boolean(activity.details);
  if (!hasDetails) {
    return (
      <div className="codex-activity-disclosure compact" data-status={activity.status}>
        <ActivityIcon kind={activity.kind} />
        <span>{label}</span>
        <small>{activityStatus(activity.status)}</small>
      </div>
    );
  }
  return (
    <details className="codex-activity-disclosure" data-status={activity.status}>
      <summary>
        <ActivityIcon kind={activity.kind} />
        <span>{label}</span>
        <small>{activityStatus(activity.status)}</small>
        <ChevronRight className="codex-disclosure-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="codex-activity-detail">
        <CodexActivityDetail activity={activity} />
      </div>
    </details>
  );
}

function CodexActivityDetail({ activity }: { activity: CodexActivity }) {
  const details = activity.details;
  if (!details) return null;
  switch (details.type) {
    case "reasoning":
      return <ReasoningDetail details={details} />;
    case "command":
      return <CommandDetail details={details} />;
    case "file_change":
      return (
        <ul className="codex-file-changes">
          {details.changes.map((change, index) => (
            <li key={`${change.path}-${index}`}>
              <strong>{change.action}</strong> <code>{change.path}</code>
              {change.diff && <pre>{change.diff}</pre>}
            </li>
          ))}
        </ul>
      );
    case "tool":
      return <ToolDetail details={details} />;
    case "web_search":
      return <WebSearchDetail details={details} />;
    case "image_generation":
      return details.prompt ? <p>{details.prompt}</p> : null;
    case "agent":
      return <AgentDetail details={details} />;
  }
}

function ToolDetail({ details }: { details: Extract<NonNullable<CodexActivity["details"]>, { type: "tool" }> }) {
  return (
    <>
      <p>
        <strong>
          {details.server ? `${details.server} · ` : ""}
          {details.name}
        </strong>
      </p>
      {details.arguments && <DetailCode label="Input" value={details.arguments} />}
      {details.result && <DetailCode label="Result" value={details.result} />}
      {details.error && <DetailCode label="Error" value={details.error} />}
      {details.durationMs !== undefined && <small>{formatDuration(details.durationMs)}</small>}
    </>
  );
}

function WebSearchDetail({
  details
}: {
  details: Extract<NonNullable<CodexActivity["details"]>, { type: "web_search" }>;
}) {
  return (
    <dl>
      {details.action && <DetailRow label="Action" value={details.action.replaceAll("_", " ")} />}
      {details.query && <DetailRow label="Query" value={details.query} />}
      {details.url && <DetailRow label="Page" value={details.url} />}
      {details.pattern && <DetailRow label="Find" value={details.pattern} />}
    </dl>
  );
}

function AgentDetail({ details }: { details: Extract<NonNullable<CodexActivity["details"]>, { type: "agent" }> }) {
  return (
    <>
      {details.prompt && <p>{details.prompt}</p>}
      {(details.model || details.reasoningEffort) && (
        <small>{[details.model, details.reasoningEffort].filter(Boolean).join(" · ")}</small>
      )}
      {details.states?.length ? (
        <ul className="codex-agent-states">
          {details.states.map((state) => (
            <li key={state.threadId}>
              <code>{shortId(state.threadId)}</code> · {state.status}
              {state.message ? ` — ${state.message}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ReasoningDetail({
  details
}: {
  details: Extract<NonNullable<CodexActivity["details"]>, { type: "reasoning" }>;
}) {
  return (
    <div className="codex-reasoning-summary">
      {details.summaries.length > 0 && (
        <section aria-label="Reasoning summary">
          <strong>Summary</strong>
          {details.summaries.map((summary, index) => (
            <p key={index}>{summary}</p>
          ))}
        </section>
      )}
      {details.rawContent?.length ? (
        <details className="codex-raw-reasoning">
          <summary>
            <ChevronRight className="codex-disclosure-chevron" size={12} aria-hidden="true" />
            <span>Raw reasoning shared with this room</span>
          </summary>
          <div>
            {details.rawContent.map((content, index) => (
              <p key={index}>{content}</p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CommandDetail({ details }: { details: Extract<NonNullable<CodexActivity["details"]>, { type: "command" }> }) {
  return (
    <>
      <DetailCode label="Command" value={details.command} />
      {details.output && <DetailCode label="Output" value={details.output} />}
      {(details.exitCode !== undefined || details.durationMs !== undefined) && (
        <small>
          {details.exitCode !== undefined ? `Exit ${details.exitCode}` : "Completed"}
          {details.durationMs !== undefined ? ` · ${formatDuration(details.durationMs)}` : ""}
        </small>
      )}
    </>
  );
}

function DetailCode({ label, value }: { label: string; value: string }) {
  return (
    <div className="codex-detail-code">
      <strong>{label}</strong>
      <pre>{value}</pre>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: CodexActivity["kind"] }) {
  if (kind === "reasoning") return <Brain size={14} aria-hidden="true" />;
  if (kind === "command") return <TerminalSquare size={14} aria-hidden="true" />;
  if (kind === "file_change") return <FilePenLine size={14} aria-hidden="true" />;
  if (kind === "web_search") return <Search size={14} aria-hidden="true" />;
  if (kind === "image_generation") return <Image size={14} aria-hidden="true" />;
  if (kind === "agent") return <Bot size={14} aria-hidden="true" />;
  return <Wrench size={14} aria-hidden="true" />;
}

function activityLabel(activity: CodexActivity): string {
  if (activity.kind === "reasoning") return "Thinking";
  if (activity.kind === "file_change") return activity.status === "completed" ? "Edited files" : "Editing files";
  if (activity.kind === "web_search") return "Looked up information";
  if (activity.kind === "image_generation") return "Generated an image";
  if (activity.kind === "agent") {
    const action = activity.agent?.action;
    return action === "spawn" ? "Spawned a subagent" : action ? `${capitalize(action)} subagent` : "Subagent activity";
  }
  return activity.title;
}

function activityStatus(status: CodexActivity["status"]): string {
  if (status === "running" || status === "started") return "In progress";
  return capitalize(status);
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
