import type { GitHubAuthConfig, SignedInUser } from "./authClient";
import { assessCodexCompatibility } from "./codexCompatibility";
import type { CodexProbe } from "./localBackend";
import type { OnboardingIntent } from "./onboardingState";
import type { CodexAccountReadiness } from "../hooks/useCodexAccount";

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
    projectCodex(input.codexProbe),
    projectChatGpt(input.codexAccount),
    projectFolder(input.projectFolderSelected)
  ];
}

function row(
  id: OnboardingReadinessRowId,
  label: string,
  status: OnboardingReadinessStatus,
  text: string,
  action: OnboardingReadinessAction | null = null
): OnboardingReadinessRow {
  return {
    id,
    label,
    status,
    text,
    blocking: status === "blocked",
    warning: status === "warning",
    action
  };
}

function projectRelay(workspace: OnboardingReadinessInput["workspace"]): OnboardingReadinessRow {
  if (workspace.status === "loading") {
    return row("relay", "Relay", "checking", "Checking the relay workspace…");
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
    return row("github", "GitHub", "checking", "Checking GitHub sign-in requirements…");
  }
  if (github.user) {
    return row("github", "GitHub", "ready", "Signed in for workspace identity, invitations, and repository workflows.");
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

function projectCodex(probe: CodexProbe | null): OnboardingReadinessRow {
  if (!probe) return row("codex", "Codex", "checking", "Checking the local Codex installation…");
  if (!probe.available) {
    return row(
      "codex",
      "Codex",
      "blocked",
      "Codex is unavailable on this device. Install or repair Codex, then check again.",
      "refresh_codex"
    );
  }
  const compatibility = assessCodexCompatibility(probe.version);
  if (compatibility.status === "unsupported_older") {
    return row("codex", "Codex", "blocked", compatibility.message, "update_codex");
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

function projectChatGpt(readiness: CodexAccountReadiness): OnboardingReadinessRow {
  switch (readiness.status) {
    case "checking":
      return row("chatgpt", "ChatGPT account", "checking", "Checking the account used by local Codex…");
    case "ready":
      return row("chatgpt", "ChatGPT account", "ready", "Codex account authorization is ready on this device.");
    case "sign_in_required":
      return row(
        "chatgpt",
        "ChatGPT account",
        "blocked",
        "Sign in with ChatGPT to authorize Codex on this device.",
        "sign_in_chatgpt"
      );
    case "native_required":
      return row("chatgpt", "ChatGPT account", "blocked", "ChatGPT account setup requires the native desktop app.");
    case "unavailable":
      return row(
        "chatgpt",
        "ChatGPT account",
        "blocked",
        "ChatGPT account status is unavailable. Check Codex again.",
        "refresh_codex"
      );
  }
}

function projectFolder(selected: boolean): OnboardingReadinessRow {
  return selected
    ? row("project", "Project access", "ready", "A project folder is selected for the first room.")
    : row(
        "project",
        "Project access",
        "warning",
        "Choose a project folder in the next workspace step. Invitees can attach one later when hosting Codex.",
        "select_project_folder"
      );
}
