import { Bot, Check, ChevronRight, FilePenLine, ShieldCheck, Terminal, Users, Wrench, X } from "lucide-react";

export type GuidedFirstTurnPhase = "host" | "composer" | "approval" | "activity" | "complete";
export type GuidedActivityKind = "thinking" | "commands" | "edits" | "tools" | "subagents";

export interface GuidedFirstTurnProps {
  phase: GuidedFirstTurnPhase;
  isActiveHost: boolean;
  activityKinds?: GuidedActivityKind[];
  onUseStarterPrompt: (prompt: string) => void;
  onReviewApproval: () => void;
  onDismiss: () => void;
}

const starterPrompts = ["Explain the structure of this project.", "Find the most important setup instructions."];
const activityLabels: Record<GuidedActivityKind, string> = {
  thinking: "Thinking",
  commands: "Commands and output",
  edits: "File edits",
  tools: "Tools",
  subagents: "Subagents"
};
const activityIcons = { thinking: Bot, commands: Terminal, edits: FilePenLine, tools: Wrench, subagents: Users };

export function GuidedFirstTurn({
  phase,
  isActiveHost,
  activityKinds = [],
  onUseStarterPrompt,
  onReviewApproval,
  onDismiss
}: GuidedFirstTurnProps) {
  return (
    <section className="guided-first-turn" aria-labelledby="guided-first-turn-title">
      <header>
        <span className="guided-first-turn-icon" aria-hidden="true">
          {phase === "complete" ? <Check size={17} /> : <Bot size={17} />}
        </span>
        <span>
          <strong id="guided-first-turn-title">Your first Codex turn</strong>
          <small>{phaseCopy(phase, isActiveHost)}</small>
        </span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss first-turn guide">
          <X size={15} />
        </button>
      </header>
      {phase === "host" && (
        <p>
          {isActiveHost
            ? "You are the active Codex host. Codex runs locally on this device for the room."
            : "The active host runs Codex. Ask them to hand off hosting if you need to run this turn."}
        </p>
      )}
      {(phase === "host" || phase === "composer") && isActiveHost && (
        <div className="guided-starters">
          <p>Choose a starter to place it in the composer. Review and send it when you’re ready.</p>
          {starterPrompts.map((prompt) => (
            <button type="button" key={prompt} onClick={() => onUseStarterPrompt(prompt)}>
              {prompt}
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      )}
      {phase === "approval" && (
        <div className="guided-approval">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Review the approval card</strong>
            <small>
              It shows the messages, project, sandbox, browser policy, and model Codex will use. This guide never
              approves automatically.
            </small>
          </span>
          <button type="button" onClick={onReviewApproval}>
            Review approval
          </button>
        </div>
      )}
      {phase === "activity" && (
        <div className="guided-activity" aria-live="polite">
          <p>Codex’s live work disclosure updates while the turn is running:</p>
          <ul>
            {(["thinking", "commands", "edits", "tools", "subagents"] as GuidedActivityKind[]).map((kind) => {
              const Icon = activityIcons[kind];
              const active = activityKinds.includes(kind);
              return (
                <li key={kind} data-active={active}>
                  <Icon size={15} aria-hidden="true" />
                  <span>{activityLabels[kind]}</span>
                  {active && <small>Visible now</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {phase === "complete" && (
        <p>The first turn is complete. The work disclosure remains available as collapsible room history.</p>
      )}
    </section>
  );
}

function phaseCopy(phase: GuidedFirstTurnPhase, isActiveHost: boolean): string {
  if (!isActiveHost && phase !== "complete") return "Hosting is on another device";
  if (phase === "approval") return "Nothing runs until the turn is approved";
  if (phase === "activity") return "Follow work as it happens";
  if (phase === "complete") return "You’re ready to keep working";
  return "Ask Codex about this project";
}
