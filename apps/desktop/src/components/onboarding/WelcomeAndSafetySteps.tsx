import { ArrowRight, Check, KeyRound, Users } from "lucide-react";
import type { RefObject } from "react";
import type { OnboardingIntent } from "../../lib/onboarding/onboardingState";
import { onboardingSafetyDefaults } from "../../application/onboarding/onboardingAssistantModel";
import { StepActions, StepHeading } from "./OnboardingPrimitives";

export function WelcomeStep({
  headingRef,
  brandIcon,
  onChooseIntent,
  onExplore
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  brandIcon: string;
  onChooseIntent: (intent: OnboardingIntent) => void;
  onExplore: () => void;
}) {
  return (
    <div className="onboarding-step onboarding-welcome">
      <div className="onboarding-hero-icon" aria-hidden="true">
        <img src={brandIcon} alt="" />
      </div>
      <StepHeading ref={headingRef} eyebrow="Welcome" title="Work with Codex together" />
      <p className="onboarding-lede">Create an encrypted project room, or join one you’ve been invited to.</p>
      <div className="onboarding-intents">
        <button type="button" onClick={() => onChooseIntent("create")}>
          <span className="onboarding-intent-icon" aria-hidden="true">
            <Users size={18} />
          </span>
          <span>
            <strong>Create a workspace</strong>
            <small>Start a team, attach a project, and invite collaborators.</small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => onChooseIntent("join")}>
          <span className="onboarding-intent-icon" aria-hidden="true">
            <KeyRound size={18} />
          </span>
          <span>
            <strong>Join with an invite</strong>
            <small>Accept a secure invitation from someone you trust.</small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="onboarding-text-button onboarding-explore" onClick={onExplore}>
        Explore the interface
      </button>
    </div>
  );
}

export function SafetyStep({
  headingRef,
  busy,
  onBack,
  onContinue
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="onboarding-step">
      <StepHeading ref={headingRef} eyebrow="Step 3" title="Start with safe defaults" />
      <p className="onboarding-lede">
        These defaults keep Codex local to the selected project and ask before it acts. You can change them per room.
      </p>
      <div className="onboarding-safety-list">
        {onboardingSafetyDefaults.map(([label, detail]) => (
          <div key={label}>
            <span aria-hidden="true">
              <Check size={15} />
            </span>
            <p>
              <strong>{label}</strong>
              <small>{detail}</small>
            </p>
          </div>
        ))}
      </div>
      <details className="onboarding-advanced">
        <summary>Advanced settings</summary>
        <p>
          Model, reasoning effort, browser allowlist, history retention, and approval policy remain available in room
          settings.
        </p>
      </details>
      <StepActions onBack={onBack}>
        <button type="button" className="onboarding-primary" onClick={onContinue} disabled={busy}>
          Enter room <ArrowRight size={16} />
        </button>
      </StepActions>
    </div>
  );
}
