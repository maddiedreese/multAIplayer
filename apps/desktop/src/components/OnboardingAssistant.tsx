import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  deriveOnboardingProgress,
  type OnboardingIntent,
  type OnboardingState,
  type OnboardingSurface
} from "../lib/onboarding/onboardingState";
import type { OnboardingReadinessAction, OnboardingReadinessRow } from "../application/onboarding/onboardingReadiness";
import type {
  OnboardingAuthenticationFlow,
  OnboardingCreateDraft,
  OnboardingJoinDraft,
  OnboardingJoinState,
  OnboardingRoomRetryDraft
} from "../application/onboarding/onboardingAssistantModel";
import { StepHeading } from "./onboarding/OnboardingPrimitives";
import { ReadinessStep } from "./onboarding/ReadinessStep";
import { WelcomeStep, SafetyStep } from "./onboarding/WelcomeAndSafetySteps";
import { CreateStep, JoinStep } from "./onboarding/WorkspaceSteps";

const brandIcon = new URL("../assets/multaiplayer-icon.png", import.meta.url).href;

export type {
  OnboardingReadinessAction,
  OnboardingReadinessRow,
  OnboardingReadinessRowId,
  OnboardingReadinessStatus
} from "../application/onboarding/onboardingReadiness";
export type {
  OnboardingAuthenticationFlow,
  OnboardingCreateDraft,
  OnboardingJoinDraft,
  OnboardingJoinState,
  OnboardingRoomRetryDraft
} from "../application/onboarding/onboardingAssistantModel";

export interface OnboardingAssistantProps {
  state: OnboardingState;
  readiness: OnboardingReadinessRow[];
  joinState?: OnboardingJoinState;
  busy?: boolean;
  message?: string | null;
  initialProjectPath?: string;
  githubAuthentication?: OnboardingAuthenticationFlow | null;
  codexAuthentication?: OnboardingAuthenticationFlow | null;
  supportsCodexDeviceLogin?: boolean;
  receivedInvite?: boolean;
  onChooseIntent: (intent: OnboardingIntent) => void;
  onExplore: () => void;
  onShowSurface: (surface: OnboardingSurface) => void;
  onReadinessAction: (action: OnboardingReadinessAction) => void;
  onStartCodexDeviceLogin?: () => void;
  onCancelGitHubAuthentication?: () => void;
  onCancelCodexAuthentication?: () => void;
  onSubmitCreate: (draft: OnboardingCreateDraft) => void;
  onRetryRoomCreation: (draft: OnboardingRoomRetryDraft) => void;
  onSubmitJoin: (draft: OnboardingJoinDraft) => void;
  onSubmitReceivedInvite?: () => void;
  onChooseProjectFolder: (currentPath: string) => Promise<string | null>;
  onContinueSafety: () => void;
  onDismiss: () => void;
}

export function OnboardingAssistant({
  state,
  readiness,
  joinState = { phase: "idle" },
  busy = false,
  message,
  initialProjectPath = "",
  githubAuthentication = null,
  codexAuthentication = null,
  supportsCodexDeviceLogin = false,
  receivedInvite = false,
  onChooseIntent,
  onExplore,
  onShowSurface,
  onReadinessAction,
  onStartCodexDeviceLogin = () => undefined,
  onCancelGitHubAuthentication = () => undefined,
  onCancelCodexAuthentication = () => undefined,
  onSubmitCreate,
  onRetryRoomCreation,
  onSubmitJoin,
  onSubmitReceivedInvite = () => undefined,
  onChooseProjectFolder,
  onContinueSafety,
  onDismiss
}: OnboardingAssistantProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const progress = deriveOnboardingProgress(state);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [state.surface, state.intent]);

  return (
    <main className="onboarding-assistant" aria-labelledby="onboarding-title">
      <div className="onboarding-shell">
        <header className="onboarding-topbar">
          <div className="onboarding-brand">
            <img className="onboarding-brand-mark" src={brandIcon} alt="" />
            <span>multAIplayer</span>
          </div>
          <button type="button" className="onboarding-text-button" onClick={onDismiss}>
            Save and close
          </button>
        </header>
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <section className="onboarding-card">
          {state.surface === "welcome" && (
            <WelcomeStep
              headingRef={headingRef}
              brandIcon={brandIcon}
              onChooseIntent={onChooseIntent}
              onExplore={onExplore}
            />
          )}
          {state.surface === "readiness" && (
            <ReadinessStep
              headingRef={headingRef}
              rows={readiness}
              busy={busy}
              githubAuthentication={githubAuthentication}
              codexAuthentication={codexAuthentication}
              supportsCodexDeviceLogin={supportsCodexDeviceLogin}
              onAction={onReadinessAction}
              onStartCodexDeviceLogin={onStartCodexDeviceLogin}
              onCancelGitHubAuthentication={onCancelGitHubAuthentication}
              onCancelCodexAuthentication={onCancelCodexAuthentication}
              onBack={() => onShowSurface("welcome")}
              onContinue={() => onShowSurface("workspace")}
            />
          )}
          {state.surface === "workspace" && state.intent === "create" && (
            <CreateStep
              headingRef={headingRef}
              busy={busy}
              pendingTeamId={state.markers.workspaceCreatedTeamId}
              initialProjectPath={initialProjectPath}
              onBack={() => onShowSurface("readiness")}
              onChooseProjectFolder={onChooseProjectFolder}
              onSubmit={onSubmitCreate}
              onRetry={onRetryRoomCreation}
            />
          )}
          {state.surface === "workspace" && state.intent === "join" && (
            <JoinStep
              headingRef={headingRef}
              busy={busy}
              joinState={joinState}
              receivedInvite={receivedInvite}
              onBack={() => onShowSurface("readiness")}
              onSubmit={onSubmitJoin}
              onSubmitReceived={onSubmitReceivedInvite}
            />
          )}
          {state.surface === "safety" && (
            <SafetyStep
              headingRef={headingRef}
              busy={busy}
              onBack={() => onShowSurface("workspace")}
              onContinue={onContinueSafety}
            />
          )}
          {state.surface === "guided_turn" && (
            <div className="onboarding-step">
              <StepHeading ref={headingRef} eyebrow="Ready to collaborate" title="Your room is ready" />
              <p className="onboarding-lede">
                Continue in the room for a guided first Codex turn. Nothing will be sent until you choose to send it.
              </p>
              <div className="onboarding-actions">
                <button type="button" className="onboarding-primary" onClick={onDismiss}>
                  Enter the room <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
          <OnboardingMessage message={message} />
        </section>
      </div>
    </main>
  );
}

function OnboardingMessage({ message }: { message: string | null | undefined }) {
  return message ? (
    <div className="onboarding-message" role="status">
      {message}
    </div>
  ) : null;
}
