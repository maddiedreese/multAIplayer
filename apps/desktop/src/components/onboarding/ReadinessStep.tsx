import { ArrowRight, Check, CircleAlert, CircleDashed, Copy, ExternalLink, LockKeyhole } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { openTrustedAuthenticationUrl } from "../../lib/identity/authExternalUrl";
import {
  hasBlockingOnboardingReadiness,
  orderOnboardingReadinessRows,
  type OnboardingAuthenticationFlow
} from "../../application/onboarding/onboardingAssistantModel";
import type {
  OnboardingReadinessAction,
  OnboardingReadinessRow,
  OnboardingReadinessStatus
} from "../../application/onboarding/onboardingReadiness";
import { StepActions, StepHeading } from "./OnboardingPrimitives";

const actionLabels: Record<OnboardingReadinessAction, string> = {
  retry_workspace_bootstrap: "Try again",
  sign_in_github: "Sign in",
  refresh_codex: "Check again",
  update_codex: "Update Codex",
  sign_in_chatgpt: "Sign in",
  select_project_folder: "Choose now"
};

export function ReadinessStep({
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
  headingRef: RefObject<HTMLHeadingElement | null>;
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
  const orderedRows = orderOnboardingReadinessRows(rows);
  const blocking = hasBlockingOnboardingReadiness(rows);
  return (
    <div className="onboarding-step">
      <StepHeading ref={headingRef} eyebrow="Step 1" title="Check this device" />
      <p className="onboarding-lede">We detect what is ready and give each issue one direct next step.</p>
      <div className="onboarding-readiness" role="list" aria-label="Device readiness">
        {orderedRows.map((row) => (
          <ReadinessRow
            key={row.id}
            row={row}
            busy={busy}
            authenticationActive={
              (row.id === "github" && Boolean(githubAuthentication)) ||
              (row.id === "chatgpt" && Boolean(codexAuthentication))
            }
            onAction={onAction}
          />
        ))}
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
          <strong>GitHub</strong> identity is required for hosted workspaces and requests only <code>read:user</code>.
          Optional pull-request and Actions workflows ask for <code>repo</code> access later, when you use them.
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

function ReadinessRow({
  row,
  busy,
  authenticationActive,
  onAction
}: {
  row: OnboardingReadinessRow;
  busy: boolean;
  authenticationActive: boolean;
  onAction: (action: OnboardingReadinessAction) => void;
}) {
  const action = row.action;
  return (
    <div className="onboarding-readiness-row" role="listitem" data-status={row.status}>
      <ReadinessIcon status={row.status} />
      <span>
        <strong>{row.label}</strong>
        <small>{row.text}</small>
      </span>
      {action && row.status !== "ready" && !authenticationActive && (
        <button type="button" onClick={() => onAction(action)} disabled={busy || row.status === "checking"}>
          {actionLabels[action]}
        </button>
      )}
    </div>
  );
}

function AuthenticationFlowPanel({ flow, onCancel }: { flow: OnboardingAuthenticationFlow; onCancel: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied_code" | "copied_link" | "failed">("idle");
  const [openStatus, setOpenStatus] = useState<"idle" | "failed">(flow.browserOpenFailed ? "failed" : "idle");
  const providerLabel = flow.provider === "github" ? "GitHub" : "ChatGPT";
  const remainingMinutes = flow.expiresAt ? Math.max(0, Math.ceil((flow.expiresAt - Date.now()) / 60_000)) : null;

  useEffect(() => {
    if (flow.browserOpenFailed) setOpenStatus("failed");
  }, [flow.browserOpenFailed]);

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

function ReadinessIcon({ status }: { status: OnboardingReadinessStatus }) {
  if (status === "ready")
    return (
      <span className="onboarding-status-icon" role="img" aria-label="Ready">
        <Check size={15} />
      </span>
    );
  if (status === "checking")
    return (
      <span className="onboarding-status-icon" role="img" aria-label="Checking">
        <CircleDashed size={15} />
      </span>
    );
  if (status === "blocked")
    return (
      <span className="onboarding-status-icon" role="img" aria-label="Blocked">
        <CircleAlert size={15} />
      </span>
    );
  return (
    <span className="onboarding-status-icon" role="img" aria-label="Warning">
      <LockKeyhole size={15} />
    </span>
  );
}
