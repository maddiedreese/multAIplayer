import { reportExpectedFailure } from "../core/nonFatalReporting";

export type CodexFollowUpBehavior = "steer" | "queue";

const storageKey = "multaiplayer:codex-follow-up-behavior";
export const defaultCodexFollowUpBehavior: CodexFollowUpBehavior = "steer";

export function loadCodexFollowUpBehavior(storage: Pick<Storage, "getItem"> | null = browserStorage()) {
  try {
    const value = storage?.getItem(storageKey);
    return value === "queue" || value === "steer" ? value : defaultCodexFollowUpBehavior;
  } catch {
    reportExpectedFailure("load the Codex follow-up preference");
    return defaultCodexFollowUpBehavior;
  }
}

export function saveCodexFollowUpBehavior(
  behavior: CodexFollowUpBehavior,
  storage: Pick<Storage, "setItem"> | null = browserStorage()
): void {
  try {
    storage?.setItem(storageKey, behavior);
  } catch {
    reportExpectedFailure("save the Codex follow-up preference");
  }
}

export function codexSteeringInput(message: string): string {
  return message.replace(/^\s*@codex(?:\b|(?=\s|[,:-]))\s*[,:-]?\s*/i, "").trim();
}

function browserStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
