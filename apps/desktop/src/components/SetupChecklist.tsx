import { ArrowRight, Check, Circle, X } from "lucide-react";
import type { OnboardingProgress } from "../lib/onboarding/onboardingState";

const labels = {
  connect_codex: "Connect Codex",
  create_or_join_room: "Create or join a room",
  attach_project: "Attach a project",
  run_first_turn: "Run the first Codex turn",
  invite_teammate: "Invite a teammate"
} as const;

export function SetupChecklist({
  progress,
  teammateJoined,
  teammateDeferred,
  onContinue,
  onDeferTeammate,
  onDismiss
}: {
  progress: OnboardingProgress;
  teammateJoined: boolean;
  teammateDeferred: boolean;
  onContinue: () => void;
  onDeferTeammate: () => void;
  onDismiss: () => void;
}) {
  if (!progress.checklistVisible) return null;
  return (
    <aside className="setup-checklist" aria-labelledby="setup-checklist-title">
      <header>
        <span>
          <strong id="setup-checklist-title">Finish setup</strong>
          <small>
            {progress.completedSteps} of {progress.totalSteps} complete
          </small>
        </span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss setup checklist">
          <X size={15} />
        </button>
      </header>
      <div
        className="setup-checklist-meter"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={progress.totalSteps}
        aria-valuenow={progress.completedSteps}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <ol>
        {progress.steps.map((step) => (
          <li key={step.id} data-complete={step.completed}>
            {step.completed ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
            <span>
              {labels[step.id]}
              {step.id === "invite_teammate" && teammateDeferred && !teammateJoined && <small>Not now</small>}
            </span>
          </li>
        ))}
      </ol>
      <div className="setup-checklist-actions">
        <button type="button" className="onboarding-primary" onClick={onContinue}>
          Continue setup <ArrowRight size={15} />
        </button>
        {progress.nextStep === "invite_teammate" && !teammateJoined && !teammateDeferred && (
          <button type="button" className="onboarding-text-button" onClick={onDeferTeammate}>
            Not now
          </button>
        )}
      </div>
    </aside>
  );
}
