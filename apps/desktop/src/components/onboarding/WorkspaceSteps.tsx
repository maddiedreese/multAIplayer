import { ArrowRight, CircleAlert, CircleDashed, FolderOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  onboardingJoinIsPending,
  onboardingJoinTitle,
  type OnboardingCreateDraft,
  type OnboardingJoinDraft,
  type OnboardingJoinState,
  type OnboardingRoomRetryDraft
} from "../../application/onboarding/onboardingAssistantModel";
import { maxInviteLinkChars } from "../../lib/invite/inviteUrl";
import { Field, StepActions, StepHeading } from "./OnboardingPrimitives";

export function CreateStep({
  headingRef,
  busy,
  pendingTeamId,
  initialProjectPath,
  onBack,
  onChooseProjectFolder,
  onSubmit,
  onRetry
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
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
      onRetry({ teamId: pendingTeamId, roomName: roomName.trim(), projectPath: projectPath.trim() });
      return;
    }
    onSubmit({ workspaceName: workspaceName.trim(), roomName: roomName.trim(), projectPath: projectPath.trim() });
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
        After the room is ready, the setup checklist will help you create a single-use bearer invite link to share
        privately with a teammate.
      </p>
      <StepActions onBack={onBack}>
        <button type="submit" className="onboarding-primary" disabled={busy}>
          {busy ? "Working…" : pendingTeamId ? "Retry room setup" : "Create workspace"} <ArrowRight size={16} />
        </button>
      </StepActions>
    </form>
  );
}

export function JoinStep({
  headingRef,
  busy,
  joinState,
  receivedInvite,
  onBack,
  onSubmit,
  onSubmitReceived
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  busy: boolean;
  joinState: OnboardingJoinState;
  receivedInvite: boolean;
  onBack: () => void;
  onSubmit: (draft: OnboardingJoinDraft) => void;
  onSubmitReceived: () => void;
}) {
  const inviteRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const pending = onboardingJoinIsPending(joinState, busy);
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
            <strong>Invitation link captured on this device.</strong> Continue to verify this device and request access
            from the active host.
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
            <strong>{onboardingJoinTitle(joinState.phase)}</strong>
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
