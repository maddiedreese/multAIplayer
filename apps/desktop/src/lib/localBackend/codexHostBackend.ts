import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isTauriRuntime } from "./runtime";
import type {
  CodexHostNotification,
  CodexHostSnapshot,
  CodexLoginStartResult,
  CodexMcpLoginResult
} from "./types";

export type CodexAppApprovalMode = "auto" | "prompt" | "writes";

export interface CoalescedAsyncTask {
  request: () => Promise<void>;
  cancelPending: () => void;
}

export function shouldRefreshCodexHostSnapshot(
  method: CodexHostNotification["method"],
  millisecondsSinceRefreshStarted: number
): boolean {
  if (
    method === "account/login/completed" ||
    method === "account/updated" ||
    method === "mcpServer/oauthLogin/completed"
  ) {
    return true;
  }
  return millisecondsSinceRefreshStarted >= 1_000;
}

/** Coalesces bursts and guarantees at most one task execution at a time. */
export function createCoalescedAsyncTask(
  task: () => Promise<void>,
  delayMs = 75
): CoalescedAsyncTask {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let queued = false;
  let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  const schedule = () => {
    if (running || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (running || !queued) return;
      queued = false;
      running = true;
      const batch = waiters;
      waiters = [];
      void task()
        .then(() => batch.forEach(({ resolve }) => resolve()))
        .catch((error) => batch.forEach(({ reject }) => reject(error)))
        .finally(() => {
          running = false;
          if (queued) schedule();
        });
    }, Math.max(0, delayMs));
  };

  return {
    request() {
      queued = true;
      const result = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
      schedule();
      return result;
    },
    cancelPending() {
      if (timer) clearTimeout(timer);
      timer = null;
      queued = false;
      const error = new Error("Coalesced task was cancelled.");
      waiters.splice(0).forEach(({ reject }) => reject(error));
    }
  };
}

export async function readCodexHostSnapshot(): Promise<CodexHostSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("Codex account controls are available in the native app.");
  }
  return invoke<CodexHostSnapshot>("codex_host_snapshot");
}

export async function startCodexLogin(
  flow: "browser" | "device",
  options: { useHostedLoginSuccessPage?: boolean; appBrand?: "codex" | "chatgpt" } = {}
): Promise<CodexLoginStartResult> {
  return invoke<CodexLoginStartResult>("codex_account_login_start", {
    request: { flow, ...options }
  });
}

export async function cancelCodexLogin(loginId: string): Promise<void> {
  await invoke("codex_account_login_cancel", { request: { loginId } });
}

export async function logoutCodexAccount(): Promise<void> {
  await invoke("codex_account_logout");
}

export async function startCodexMcpLogin(name: string): Promise<CodexMcpLoginResult> {
  return invoke<CodexMcpLoginResult>("codex_mcp_login_start", { request: { name } });
}

export async function setCodexAppApprovalMode(mode: CodexAppApprovalMode): Promise<void> {
  await invoke("codex_app_approval_mode_set", { request: { mode } });
}

export async function listenForCodexHostNotifications(
  listener: (notification: CodexHostNotification) => void
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<CodexHostNotification>("codex://host-notification", (event) => listener(event.payload));
}
