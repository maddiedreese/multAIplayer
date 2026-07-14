import type { OnboardingReadinessRow, OnboardingReadinessRowId } from "./onboardingReadiness";

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
  browserOpenFailed: boolean;
}

export type OnboardingAuthenticationProvider = OnboardingAuthenticationFlow["provider"];

export const onboardingReadinessOrder: readonly OnboardingReadinessRowId[] = [
  "relay",
  "github",
  "codex",
  "chatgpt",
  "project"
];

export const onboardingSafetyDefaults = [
  ["Ask before every Codex turn", "You decide when Codex starts."],
  ["Workspace-write sandbox", "Codex is limited to the selected project."],
  ["Raw reasoning sharing off", "Only reasoning summaries are shared by default."],
  ["Browser access restricted", "Sites must be explicitly allowed."],
  ["Local history", "Encrypted room history stays on this device until you clear it."]
] as const;

export function orderOnboardingReadinessRows(rows: readonly OnboardingReadinessRow[]): OnboardingReadinessRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return onboardingReadinessOrder.flatMap((id) => {
    const row = rowsById.get(id);
    return row ? [row] : [];
  });
}

export function hasBlockingOnboardingReadiness(rows: readonly OnboardingReadinessRow[]): boolean {
  const orderedRows = orderOnboardingReadinessRows(rows);
  return orderedRows.length !== onboardingReadinessOrder.length || orderedRows.some((row) => row.blocking);
}

/**
 * Continue only when an authentication the user started in this readiness step
 * changes from not-ready to ready and that success clears the final blocker.
 * Initial bootstrap, background probes, warnings, and invite receipt cannot
 * advance the assistant. The caller clears the attempt after a successful
 * decision, so a later readiness refresh cannot advance a second time.
 */
export function successfulAuthenticationReadyToAdvance({
  previousRows,
  currentRows,
  attemptedProviders
}: {
  previousRows: readonly OnboardingReadinessRow[] | null;
  currentRows: readonly OnboardingReadinessRow[];
  attemptedProviders: ReadonlySet<OnboardingAuthenticationProvider>;
}): boolean {
  if (!previousRows || attemptedProviders.size === 0 || hasBlockingOnboardingReadiness(currentRows)) return false;

  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  return (["github", "chatgpt"] as const).some((provider) => {
    if (!attemptedProviders.has(provider)) return false;
    return previousById.get(provider)?.status !== "ready" && currentById.get(provider)?.status === "ready";
  });
}

export function onboardingJoinIsPending(state: OnboardingJoinState, busy: boolean): boolean {
  return busy || state.phase === "accepting" || state.phase === "verification_required" || state.phase === "complete";
}

export function onboardingJoinTitle(phase: OnboardingJoinState["phase"]): string {
  if (phase === "verification_required") return "Device verification required";
  if (phase === "error") return "Could not join yet";
  if (phase === "complete") return "Invite accepted";
  return "Accepting invite";
}
