import React from "react";
import { GuidedFirstTurn } from "../../../apps/desktop/src/components/GuidedFirstTurn";
import { HelpDrawerPanel } from "../../../apps/desktop/src/components/HelpDrawerPanel";
import {
  OnboardingAssistant,
  type OnboardingAssistantProps,
  type OnboardingJoinState
} from "../../../apps/desktop/src/components/OnboardingAssistant";
import { SetupChecklist } from "../../../apps/desktop/src/components/SetupChecklist";
import {
  deriveOnboardingProgress,
  loadOnboardingState,
  reduceOnboardingState,
  saveOnboardingState,
  type OnboardingEvent,
  type OnboardingState
} from "../../../apps/desktop/src/lib/onboarding/onboardingState";
import type {
  OnboardingReadinessAction,
  OnboardingReadinessRow
} from "../../../apps/desktop/src/application/onboarding/onboardingReadiness";

export const description =
  "Production onboarding, setup checklist, Help recovery, and first-turn guidance with deterministic resumable transitions.";
export const mockedBoundaries = [
  "relay HTTP workspace bootstrap and mutations",
  "GitHub and ChatGPT authentication",
  "native Codex probe and account state",
  "native project folder dialog",
  "MLS invite verification and host approval",
  "encrypted persistence and Codex execution"
] as const;

const readyRow = (id: OnboardingReadinessRow["id"], label: string, text: string): OnboardingReadinessRow => ({
  id,
  label,
  text,
  status: "ready",
  blocking: false,
  warning: false,
  action: null
});

export default function OnboardingScenario() {
  const [state, setState] = React.useState<OnboardingState>(() => loadOnboardingState());
  const [relayReady, setRelayReady] = React.useState(false);
  const [codexReady, setCodexReady] = React.useState(false);
  const [joinState, setJoinState] = React.useState<OnboardingJoinState>({ phase: "idle" });
  const [message, setMessage] = React.useState<string | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sendCount] = React.useState(0);
  const [teamCreateCount, setTeamCreateCount] = React.useState(0);
  const [roomCreateCount, setRoomCreateCount] = React.useState(0);

  function apply(event: OnboardingEvent) {
    setState((current) => {
      const next = reduceOnboardingState(current, event);
      saveOnboardingState(next);
      return next;
    });
  }

  const readiness: OnboardingReadinessRow[] = [
    relayReady
      ? readyRow("relay", "Relay", "Connected and ready for workspace setup.")
      : {
          id: "relay",
          label: "Relay",
          text: "The relay workspace could not be reached. Check the connection and try again.",
          status: "blocked",
          blocking: true,
          warning: false,
          action: "retry_workspace_bootstrap"
        },
    readyRow("github", "GitHub", "Signed in for workspace identity, invitations, and repository workflows."),
    codexReady
      ? readyRow("codex", "Codex", "Compatible with the contract-tested app-server range.")
      : {
          id: "codex",
          label: "Codex",
          text: "Codex is unavailable on this device. Install or repair Codex, then check again.",
          status: "blocked",
          blocking: true,
          warning: false,
          action: "refresh_codex"
        },
    readyRow("chatgpt", "ChatGPT account", "Codex account authorization is ready on this device."),
    {
      id: "project",
      label: "Project access",
      text: "Choose a project folder in the next workspace step. Invitees can attach one later when hosting Codex.",
      status: "warning",
      blocking: false,
      warning: true,
      action: "select_project_folder"
    }
  ];

  function readinessAction(action: OnboardingReadinessAction) {
    if (action === "retry_workspace_bootstrap") setRelayReady(true);
    if (action === "refresh_codex") setCodexReady(true);
  }

  const assistantProps: OnboardingAssistantProps = {
    state,
    readiness,
    joinState,
    message,
    initialProjectPath: "/tmp/multaiplayer-onboarding",
    onChooseIntent: (intent) => apply({ type: "choose_intent", intent }),
    onExplore: () => apply({ type: "skip_assistant" }),
    onShowSurface: (surface) => apply({ type: "show_surface", surface }),
    onReadinessAction: readinessAction,
    onSubmitCreate: () => {
      setTeamCreateCount((count) => count + 1);
      setRoomCreateCount((count) => count + 1);
      setMessage("The workspace was created, but the first room was not. Retry without creating a duplicate.");
      apply({ type: "workspace_created", teamId: "team_onboarding" });
    },
    onRetryRoomCreation: () => {
      setRoomCreateCount((count) => count + 1);
      setMessage("Your encrypted workspace and first room are ready.");
      apply({ type: "room_ready", intent: "create", teamId: "team_onboarding", roomId: "room_onboarding" });
      apply({ type: "project_attached", roomId: "room_onboarding" });
    },
    onSubmitJoin: () =>
      setJoinState({
        phase: "verification_required",
        message: "The active host must verify and approve this device before the room unlocks."
      }),
    onChooseProjectFolder: async () => "/tmp/multaiplayer-onboarding",
    onContinueSafety: () => apply({ type: "show_surface", surface: "guided_turn" }),
    onDismiss: () => apply({ type: "dismiss_assistant" })
  };

  const progress = deriveOnboardingProgress(state);
  const showAssistant = progress.assistantVisible && state.surface !== "guided_turn";
  if (showAssistant) return <OnboardingAssistant {...assistantProps} />;

  return (
    <section className="e2e-onboarding-shell" aria-label="Onboarding shell UI contract">
      <header>
        <strong>multAIplayer workspace</strong>
        <button type="button" onClick={() => setHelpOpen((open) => !open)}>
          Help
        </button>
      </header>
      <div className="e2e-onboarding-body">
        <aside>
          <SetupChecklist
            progress={progress}
            teammateJoined={state.markers.teammateJoined}
            teammateDeferred={state.markers.teammateDeferred}
            onContinue={() => apply({ type: "reopen_assistant" })}
            onDeferTeammate={() => undefined}
            onDismiss={() => apply({ type: "dismiss_checklist" })}
          />
        </aside>
        <main>
          {state.surface === "guided_turn" ? (
            <>
              <GuidedFirstTurn
                phase="composer"
                isActiveHost
                onUseStarterPrompt={setDraft}
                onReviewApproval={() => undefined}
                onDismiss={() => undefined}
              />
              <label>
                First-turn draft
                <textarea
                  aria-label="First-turn draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              <p data-testid="send-count">Sent turns: {sendCount}</p>
            </>
          ) : (
            <p>Explore the interface while setup remains resumable.</p>
          )}
          <p data-testid="create-counts">
            Team creates: {teamCreateCount}; room creates: {roomCreateCount}
          </p>
        </main>
        {helpOpen && (
          <aside aria-label="Help panel">
            <HelpDrawerPanel
              completedSteps={progress.completedSteps}
              totalSteps={progress.totalSteps}
              onOpenSetupGuide={() => {
                apply({ type: "reopen_assistant" });
                setHelpOpen(false);
              }}
              onShowSetupChecklist={() => apply({ type: "reopen_checklist" })}
              onRestartSetupGuide={() => {
                apply({ type: "reset" });
                setRelayReady(false);
                setCodexReady(false);
                setJoinState({ phase: "idle" });
                setMessage(null);
                setHelpOpen(false);
              }}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
