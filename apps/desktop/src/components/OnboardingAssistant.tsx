import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  CircleDashed,
  FolderOpen,
  Copy,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  deriveOnboardingProgress,
  type OnboardingIntent,
  type OnboardingState,
  type OnboardingSurface
} from "../lib/onboardingState";
import type {
  OnboardingReadinessAction,
  OnboardingReadinessRow,
  OnboardingReadinessRowId,
  OnboardingReadinessStatus
} from "../lib/onboardingReadiness";
import { openTrustedAuthenticationUrl } from "../lib/authExternalUrl";
import { maxInviteLinkChars } from "../lib/inviteUrl";
export type {
  OnboardingReadinessAction,
  OnboardingReadinessRow,
  OnboardingReadinessRowId,
  OnboardingReadinessStatus
} from "../lib/onboardingReadiness";

export interface OnboardingCreateDraft {
  workspaceName: string;
  roomName: string;
  projectPath: string;
}

export interface OnboardingRoomRetryDraft extends Omit<OnboardingCreateDraft, "workspaceName"> {
  teamId: string;
}

export interface OnboardingJoinDraft {
  invite: string;
}

export interface OnboardingJoinState {
  phase: "idle" | "accepting" | "verification_required" | "complete" | "error";
  message?: string;
}

export interface OnboardingAuthenticationFlow {
  provider: "github" | "chatgpt";
  flow: "browser" | "device";
  url: string;
  userCode: string | null;
  expiresAt: number | null;
}

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

const readinessOrder: OnboardingReadinessRowId[] = ["relay", "github", "codex", "chatgpt", "project"];
const readinessActionLabels: Record<OnboardingReadinessAction, string> = {
  retry_workspace_bootstrap: "Try again",
  sign_in_github: "Sign in",
  refresh_codex: "Check again",
  update_codex: "Update Codex",
  sign_in_chatgpt: "Sign in",
  select_project_folder: "Choose now"
};

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
            <span className="onboarding-brand-mark" aria-hidden="true">
              <Users size={17} />
            </span>
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
            <WelcomeStep headingRef={headingRef} onChooseIntent={onChooseIntent} onExplore={onExplore} />
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
          {message && (
            <div className="onboarding-message" role="status">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function WelcomeStep({
  headingRef,
  onChooseIntent,
  onExplore
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onChooseIntent: (intent: OnboardingIntent) => void;
  onExplore: () => void;
}) {
  return (
    <div className="onboarding-step onboarding-welcome">
      <div className="onboarding-hero-icon" aria-hidden="true">
        <Bot size={26} />
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

function ReadinessStep({
  headingRef,
  rows,
  busy,
  githubAuthentication,
  codexAuthentication,
  supportsCodexDeviceLogin,
  onAction,
  onStartCodexDeviceLogin,
  onCancelGitHubAuthentication,
  onCancelCodexAuthentication,
  onBack,
  onContinue
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  rows: OnboardingReadinessRow[];
  busy: boolean;
  githubAuthentication: OnboardingAuthenticationFlow | null;
  codexAuthentication: OnboardingAuthenticationFlow | null;
  supportsCodexDeviceLogin: boolean;
  onAction: (action: OnboardingReadinessAction) => void;
  onStartCodexDeviceLogin: () => void;
  onCancelGitHubAuthentication: () => void;
  onCancelCodexAuthentication: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = readinessOrder.map((id) => rowsById.get(id)).filter(Boolean) as OnboardingReadinessRow[];
  const blocking = orderedRows.length !== readinessOrder.length || orderedRows.some((row) => row.blocking);
  return (
    <div className="onboarding-step">
      <StepHeading ref={headingRef} eyebrow="Step 1" title="Check this device" />
      <p className="onboarding-lede">We detect what is ready and give each issue one direct next step.</p>
      <div className="onboarding-readiness" role="list" aria-label="Device readiness">
        {orderedRows.map((row) => {
          const action = row.action;
          return (
            <div className="onboarding-readiness-row" role="listitem" key={row.id} data-status={row.status}>
              <ReadinessIcon status={row.status} />
              <span>
                <strong>{row.label}</strong>
                <small>{row.text}</small>
              </span>
              {action &&
                row.status !== "ready" &&
                !(row.id === "github" && githubAuthentication) &&
                !(row.id === "chatgpt" && codexAuthentication) && (
                  <button type="button" onClick={() => onAction(action)} disabled={busy || row.status === "checking"}>
                    {readinessActionLabels[action]}
                  </button>
                )}
            </div>
          );
        })}
      </div>
      {githubAuthentication && (
        <AuthenticationFlowPanel flow={githubAuthentication} onCancel={onCancelGitHubAuthentication} />
      )}
      {codexAuthentication ? (
        <AuthenticationFlowPanel flow={codexAuthentication} onCancel={onCancelCodexAuthentication} />
      ) : (
        supportsCodexDeviceLogin &&
        orderedRows.some((row) => row.id === "chatgpt" && row.action === "sign_in_chatgpt") && (
          <button type="button" className="onboarding-text-button" onClick={onStartCodexDeviceLogin}>
            Use a ChatGPT device code instead
          </button>
        )
      )}
      <div className="onboarding-auth-explainer">
        <p>
          <strong>GitHub</strong> identifies workspace members and enables repository workflows.
        </p>
        <p>
          <strong>ChatGPT</strong> authorizes the local Codex process that performs work.
        </p>
      </div>
      <StepActions onBack={onBack}>
        <button type="button" className="onboarding-primary" onClick={onContinue} disabled={busy || blocking}>
          Continue <ArrowRight size={16} />
        </button>
      </StepActions>
    </div>
  );
}

function AuthenticationFlowPanel({ flow, onCancel }: { flow: OnboardingAuthenticationFlow; onCancel: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied_code" | "copied_link" | "failed">("idle");
  const [openStatus, setOpenStatus] = useState<"idle" | "failed">("idle");
  const providerLabel = flow.provider === "github" ? "GitHub" : "ChatGPT";
  const remainingMinutes = flow.expiresAt ? Math.max(0, Math.ceil((flow.expiresAt - Date.now()) / 60_000)) : null;

  async function copyCode() {
    if (!flow.userCode) return;
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCopyStatus("copied_code");
    } catch {
      setCopyStatus("failed");
    }
  }

  async function openAuthentication() {
    const provider = flow.provider === "github" ? "github" : "openai";
    setOpenStatus((await openTrustedAuthenticationUrl(provider, flow.url)) ? "idle" : "failed");
  }

  async function copyAuthenticationLink() {
    try {
      await navigator.clipboard.writeText(flow.url);
      setCopyStatus("copied_link");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="onboarding-auth-flow" aria-label={`${providerLabel} sign-in`}>
      <div>
        <strong>Finish signing in with {providerLabel}</strong>
        <small role="status" aria-live="polite">
          Waiting for authorization in your browser. You can cancel and continue setup later.
        </small>
        {remainingMinutes !== null && (
          <small>
            {remainingMinutes > 0
              ? `This code expires in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`
              : "This code has expired. Cancel sign-in and start again."}
          </small>
        )}
      </div>
      {flow.userCode && (
        <div className="onboarding-auth-code">
          <span>{providerLabel} code</span>
          <strong aria-label={`${providerLabel} device code`}>{flow.userCode}</strong>
          <button type="button" onClick={() => void copyCode()} aria-label={`Copy ${providerLabel} device code`}>
            <Copy size={14} /> Copy
          </button>
        </div>
      )}
      <div className="onboarding-auth-actions">
        <button type="button" onClick={() => void openAuthentication()}>
          Open {providerLabel} in your browser <ExternalLink size={14} />
        </button>
        <button type="button" onClick={onCancel}>
          Cancel sign-in
        </button>
      </div>
      {openStatus === "failed" && (
        <div className="onboarding-auth-fallback" role="alert">
          <span>The system browser could not be opened.</span>
          <button type="button" onClick={() => void copyAuthenticationLink()}>
            <Copy size={14} /> Copy sign-in link
          </button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copyStatus === "copied_code"
          ? `${providerLabel} code copied.`
          : copyStatus === "copied_link"
            ? `${providerLabel} sign-in link copied.`
            : copyStatus === "failed"
              ? `Could not copy the ${providerLabel} code. Select the visible code instead.`
              : ""}
      </span>
    </section>
  );
}

function CreateStep({
  headingRef,
  busy,
  pendingTeamId,
  initialProjectPath,
  onBack,
  onChooseProjectFolder,
  onSubmit,
  onRetry
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  pendingTeamId: string | null;
  initialProjectPath: string;
  onBack: () => void;
  onChooseProjectFolder: (currentPath: string) => Promise<string | null>;
  onSubmit: (draft: OnboardingCreateDraft) => void;
  onRetry: (draft: OnboardingRoomRetryDraft) => void;
}) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [roomName, setRoomName] = useState("general");
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [folderError, setFolderError] = useState(false);
  const prefix = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingTeamId) {
      onRetry({
        teamId: pendingTeamId,
        roomName: roomName.trim(),
        projectPath: projectPath.trim()
      });
      return;
    }
    onSubmit({
      workspaceName: workspaceName.trim(),
      roomName: roomName.trim(),
      projectPath: projectPath.trim()
    });
  }

  async function chooseProjectFolder() {
    setFolderError(false);
    try {
      const selected = await onChooseProjectFolder(projectPath);
      if (selected !== null) setProjectPath(selected);
    } catch {
      setFolderError(true);
    }
  }

  return (
    <form className="onboarding-step" onSubmit={submit}>
      <StepHeading
        ref={headingRef}
        eyebrow="Step 2"
        title={pendingTeamId ? "Finish your first room" : "Create your workspace"}
      />
      {pendingTeamId && (
        <div className="onboarding-recovery" role="status">
          <RefreshCw size={17} aria-hidden="true" />
          <span>
            <strong>Your workspace was created.</strong> Retry the room setup without creating another workspace.
          </span>
        </div>
      )}
      {!pendingTeamId && (
        <Field id={`${prefix}-workspace`} label="Workspace name">
          <input
            id={`${prefix}-workspace`}
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            maxLength={120}
            required
            autoComplete="off"
          />
        </Field>
      )}
      <Field id={`${prefix}-room`} label="First room name">
        <input
          id={`${prefix}-room`}
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          maxLength={160}
          required
          autoComplete="off"
        />
      </Field>
      {folderError && (
        <div className="onboarding-message" role="alert">
          The project folder could not be selected. Check folder access and try again.
        </div>
      )}
      <Field
        id={`${prefix}-project`}
        label="Project folder"
        hint="Choose only the folder Codex should be allowed to work in."
      >
        <div className="onboarding-input-action">
          <input
            id={`${prefix}-project`}
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
            maxLength={2048}
            required
            autoComplete="off"
          />
          <button type="button" onClick={() => void chooseProjectFolder()} aria-label="Choose project folder">
            <FolderOpen size={16} />
          </button>
        </div>
      </Field>
      <p className="onboarding-form-note">
        After the room is ready, the setup checklist will help you create a secure invite link for a teammate.
      </p>
      <StepActions onBack={onBack}>
        <button type="submit" className="onboarding-primary" disabled={busy}>
          {busy ? "Working…" : pendingTeamId ? "Retry room setup" : "Create workspace"} <ArrowRight size={16} />
        </button>
      </StepActions>
    </form>
  );
}

function JoinStep({
  headingRef,
  busy,
  joinState,
  receivedInvite,
  onBack,
  onSubmit,
  onSubmitReceived
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  joinState: OnboardingJoinState;
  receivedInvite: boolean;
  onBack: () => void;
  onSubmit: (draft: OnboardingJoinDraft) => void;
  onSubmitReceived: () => void;
}) {
  const inviteRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const pending =
    busy ||
    joinState.phase === "accepting" ||
    joinState.phase === "verification_required" ||
    joinState.phase === "complete";
  return (
    <form
      className="onboarding-step"
      onSubmit={(event) => {
        event.preventDefault();
        const protectedInvite = inviteRef.current?.value.trim() ?? "";
        if (!protectedInvite) return;
        if (inviteRef.current) inviteRef.current.value = "";
        onSubmit({ invite: protectedInvite });
      }}
    >
      <StepHeading ref={headingRef} eyebrow="Step 2" title="Join a workspace" />
      <p className="onboarding-lede">
        Paste the invite you received. Device verification will appear here if the workspace requires it.
      </p>
      {receivedInvite ? (
        <div className="onboarding-recovery" role="status">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>
            <strong>Invitation received securely.</strong> Continue to verify this device and request access from the
            active host.
          </span>
        </div>
      ) : (
        <Field id={id} label="Invite link or code">
          <input
            id={id}
            ref={inviteRef}
            maxLength={maxInviteLinkChars}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      {joinState.phase !== "idle" && (
        <div className="onboarding-join-state" role="status" data-phase={joinState.phase}>
          {joinState.phase === "verification_required" ? (
            <ShieldCheck size={18} />
          ) : joinState.phase === "error" ? (
            <CircleAlert size={18} />
          ) : (
            <CircleDashed size={18} />
          )}
          <span>
            <strong>
              {joinState.phase === "verification_required"
                ? "Device verification required"
                : joinState.phase === "error"
                  ? "Could not join yet"
                  : joinState.phase === "complete"
                    ? "Invite accepted"
                    : "Accepting invite"}
            </strong>
            {joinState.message && <small>{joinState.message}</small>}
          </span>
        </div>
      )}
      <StepActions onBack={onBack}>
        <button
          type={receivedInvite ? "button" : "submit"}
          className="onboarding-primary"
          disabled={pending}
          onClick={receivedInvite ? onSubmitReceived : undefined}
        >
          {pending ? "Waiting…" : "Accept invite"} <ArrowRight size={16} />
        </button>
      </StepActions>
    </form>
  );
}

function SafetyStep({
  headingRef,
  busy,
  onBack,
  onContinue
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const defaults = [
    ["Ask before every Codex turn", "You decide when Codex starts."],
    ["Workspace-write sandbox", "Codex is limited to the selected project."],
    ["Raw reasoning sharing off", "Only reasoning summaries are shared by default."],
    ["Browser access restricted", "Sites must be explicitly allowed."],
    ["Local history", "Encrypted room history stays on this device until you clear it."]
  ];
  return (
    <div className="onboarding-step">
      <StepHeading ref={headingRef} eyebrow="Step 3" title="Start with safe defaults" />
      <p className="onboarding-lede">
        These defaults keep Codex local to the selected project and ask before it acts. You can change them per room.
      </p>
      <div className="onboarding-safety-list">
        {defaults.map(([label, detail]) => (
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
          Model, reasoning effort, browser allowlist, history retention, and approval delegation remain available in
          room settings.
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

const StepHeading = ({
  eyebrow,
  title,
  ref
}: {
  eyebrow: string;
  title: string;
  ref: React.Ref<HTMLHeadingElement>;
}) => (
  <div className="onboarding-heading">
    <span>{eyebrow}</span>
    <h1 id="onboarding-title" ref={ref} tabIndex={-1}>
      {title}
    </h1>
  </div>
);

function StepActions({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="onboarding-actions">
      <button type="button" className="onboarding-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>
      {children}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="onboarding-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function ReadinessIcon({ status }: { status: OnboardingReadinessStatus }) {
  if (status === "ready")
    return (
      <span className="onboarding-status-icon" aria-label="Ready">
        <Check size={15} />
      </span>
    );
  if (status === "checking")
    return (
      <span className="onboarding-status-icon" aria-label="Checking">
        <CircleDashed size={15} />
      </span>
    );
  if (status === "blocked")
    return (
      <span className="onboarding-status-icon" aria-label="Blocked">
        <CircleAlert size={15} />
      </span>
    );
  return (
    <span className="onboarding-status-icon" aria-label="Warning">
      <LockKeyhole size={15} />
    </span>
  );
}
