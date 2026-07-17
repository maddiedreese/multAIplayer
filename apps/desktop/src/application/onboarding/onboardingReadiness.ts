import type { GitHubAuthConfig, SignedInUser } from "../../lib/identity/authClient";
import { assessCodexCompatibility } from "../../lib/codex/codexCompatibility";
import type { CodexProbe } from "../../lib/platform/localBackend";
import type { OnboardingIntent } from "../../lib/onboarding/onboardingState";
import type { CodexAccountReadiness } from "../../lib/codex/codexAccountReadiness";

export type OnboardingReadinessRowId = "relay" | "github" | "codex" | "chatgpt" | "project";
export type OnboardingReadinessStatus = "checking" | "ready" | "warning" | "blocked";
export type OnboardingReadinessAction =
  | "retry_workspace_bootstrap"
  | "sign_in_github"
  | "refresh_codex"
  | "update_codex"
  | "sign_in_chatgpt"
  | "select_project_folder";

export interface OnboardingReadinessRow {
  id: OnboardingReadinessRowId;
  label: string;
  status: OnboardingReadinessStatus;
  text: string;
  blocking: boolean;
  warning: boolean;
  action: OnboardingReadinessAction | null;
}

export interface OnboardingReadinessInput {
  intent: OnboardingIntent;
  workspace: {
    status: "loading" | "ready" | "error";
    error: string | null;
  };
  github: {
    configResolved: boolean;
    userResolved: boolean;
    config: GitHubAuthConfig | null;
    user: SignedInUser | null;
    busy: boolean;
    error: string | null;
  };
  codexProbe: CodexProbe | null;
  codexAccount: CodexAccountReadiness;
  projectFolderSelected: boolean;
}

/**
 * Produces display-safe setup status. Arbitrary upstream errors are deliberately
 * reduced to fixed copy so paths, URLs, account details, and credentials cannot
 * cross into onboarding presentation or analytics by accident.
 */
export function projectOnboardingReadiness(input: OnboardingReadinessInput): OnboardingReadinessRow[] {
  return [
    projectRelay(input.workspace),
    projectGitHub(input.intent, input.github),
    projectCodex(input.intent, input.codexProbe),
    projectChatGpt(input.intent, input.codexAccount),
    projectFolder(input.intent, input.projectFolderSelected)
  ];
}

function row(
  id: OnboardingReadinessRowId,
  label: string,
  status: OnboardingReadinessStatus,
  text: string,
  action: OnboardingReadinessAction | null = null,
  blocking = status === "blocked"
): OnboardingReadinessRow {
  return {
    id,
    label,
    status,
    text,
    blocking,
    warning: status === "warning",
    action
  };
}

function projectRelay(workspace: OnboardingReadinessInput["workspace"]): OnboardingReadinessRow {
  if (workspace.status === "loading") {
    return row("relay", "Relay", "checking", "Checking the relay workspace…", null, true);
  }
  if (workspace.status === "error") {
    return row(
      "relay",
      "Relay",
      "blocked",
      "The relay workspace could not be reached. Check the connection and try again.",
      "retry_workspace_bootstrap"
    );
  }
  return row("relay", "Relay", "ready", "Connected and ready for workspace setup.");
}

function projectGitHub(intent: OnboardingIntent, github: OnboardingReadinessInput["github"]): OnboardingReadinessRow {
  const required = intent === "join" || github.config?.mutationsRequireAuth === true;
  if (!github.configResolved || !github.userResolved || github.busy) {
    return row("github", "GitHub", "checking", "Checking GitHub sign-in requirements…", null, true);
  }
  if (!github.config) {
    return row(
      "github",
      "GitHub",
      "blocked",
      "GitHub sign-in requirements could not be checked. Check the relay connection and try again.",
      "retry_workspace_bootstrap"
    );
  }
  if (github.user) {
    return row(
      "github",
      "GitHub",
      "ready",
      "Signed in for workspace identity. Optional GitHub workflows request repository permission when used."
    );
  }
  if (!github.config?.configured) {
    return required
      ? row(
          "github",
          "GitHub",
          "blocked",
          "GitHub sign-in is required for this setup path but is not configured on the relay."
        )
      : row(
          "github",
          "GitHub",
          "warning",
          "Optional for local workspace creation; invitations and GitHub workflows remain unavailable."
        );
  }
  if (required) {
    return row(
      "github",
      "GitHub",
      "blocked",
      intent === "join"
        ? "Sign in with GitHub to identify this device before requesting invite access."
        : "This relay requires GitHub sign-in before workspace changes.",
      "sign_in_github"
    );
  }
  return row(
    "github",
    "GitHub",
    "warning",
    "Optional for local workspace creation; sign in to use invitations, pull requests, and Actions.",
    "sign_in_github"
  );
}

function projectCodex(intent: OnboardingIntent, probe: CodexProbe | null): OnboardingReadinessRow {
  const required = intent === "create";
  if (!probe) {
    return row(
      "codex",
      "Codex",
      "checking",
      required
        ? "Checking the local Codex installation…"
        : "Checking Codex in the background. It is only required when this device hosts Codex.",
      null,
      required
    );
  }
  if (!probe.available) {
    return row(
      "codex",
      "Codex",
      required ? "blocked" : "warning",
      required
        ? "Codex is unavailable on this device. Install or repair Codex, then check again."
        : "Codex is not ready on this device. You can join now and install it before hosting Codex.",
      "refresh_codex"
    );
  }
  const compatibility = assessCodexCompatibility(probe.version);
  if (compatibility.status === "unsupported_older") {
    return row("codex", "Codex", required ? "blocked" : "warning", compatibility.message, "update_codex");
  }
  if (compatibility.status === "unverified_newer") {
    return row("codex", "Codex", "warning", compatibility.message, "refresh_codex");
  }
  if (compatibility.status === "unknown") {
    return row(
      "codex",
      "Codex",
      "warning",
      "Codex is available, but its version could not be matched to the tested compatibility policy.",
      "refresh_codex"
    );
  }
  return row("codex", "Codex", "ready", compatibility.message);
}

function projectChatGpt(intent: OnboardingIntent, readiness: CodexAccountReadiness): OnboardingReadinessRow {
  const required = intent === "create";
  switch (readiness.status) {
    case "checking":
      return row(
        "chatgpt",
        "ChatGPT account",
        "checking",
        required
          ? "Checking the account used by local Codex…"
          : "Checking the local Codex account in the background. It is not required to join.",
        null,
        required
      );
    case "ready":
      return row("chatgpt", "ChatGPT account", "ready", "Codex account authorization is ready on this device.");
    case "sign_in_required":
      return row(
        "chatgpt",
        "ChatGPT account",
        required ? "blocked" : "warning",
        required
          ? "Sign in with ChatGPT to authorize Codex on this device."
          : "ChatGPT sign-in is only required before this device hosts Codex.",
        "sign_in_chatgpt"
      );
    case "native_required":
      return row(
        "chatgpt",
        "ChatGPT account",
        required ? "blocked" : "warning",
        "ChatGPT account setup requires the native desktop app."
      );
    case "unavailable":
      return row(
        "chatgpt",
        "ChatGPT account",
        required ? "blocked" : "warning",
        required
          ? "ChatGPT account status is unavailable. Check Codex again."
          : "ChatGPT account status is unavailable, but it is not required to join.",
        "refresh_codex"
      );
  }
}

function projectFolder(intent: OnboardingIntent, selected: boolean): OnboardingReadinessRow {
  return selected
    ? row("project", "Project access", "ready", "A project folder is selected for the first room.")
    : row(
        "project",
        "Project access",
        "warning",
        intent === "join"
          ? "Join now and attach a project later if this device hosts Codex."
          : "Choose a project folder now or in the next workspace step.",
        intent === "join" ? null : "select_project_folder"
      );
}
