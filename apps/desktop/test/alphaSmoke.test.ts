import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientRoomRecord } from "@multaiplayer/protocol";
import { canRequestBrowserAccess, canHostBrowserAction } from "../src/lib/browserPolicy";
import { canApproveCodexTurn } from "../src/lib/codexApproval";
import { buildCodexApprovalSnapshot, buildCodexTurnInput, type CodexChatMessage } from "../src/lib/codexTurn";
import { resolveFilePreviewTab } from "../src/lib/filePreview";
import { checkGitHubActionsReadiness, checkGitHubWorkflowReadiness } from "../src/lib/githubWorkflowReadiness";
import { createHandoffSettingsPatch, hostHandoffDetail } from "../src/lib/hostHandoff";
import { saveEncryptedHistory, loadEncryptedHistory, saveHistorySettings } from "../src/lib/localHistory";
import { canUseRoomChat, canStageRoomChatAttachment } from "../src/lib/chatPolicy";
import { terminalRequestForApprovedRun, canActOnRoomTerminalRequest } from "../src/lib/terminalApproval";
import { canUseLocalWorkspace } from "../src/lib/workspaceAccess";
import { normalizeCodexModel, planRoomCreation, planTeamCreation } from "../src/lib/workspaceCreation";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  dump(): string {
    return Array.from(this.values.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  }
}

const localStorage = new MemoryStorage();
let nativeHistory: string | null = null;
(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: { request?: { plaintext?: string } }) => {
    if (command === "mls_history_save") {
      nativeHistory = args.request?.plaintext ?? null;
      return 1;
    }
    if (command === "mls_history_load_latest") return nativeHistory;
    if (command === "mls_history_retention_set") return 1;
    if (command === "mls_history_delete_all") {
      nativeHistory = null;
      return null;
    }
    throw new Error(`Unexpected native command: ${command}`);
  }
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorage
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis
});

test.beforeEach(() => {
  localStorage.clear();
  nativeHistory = null;
});

test("alpha smoke flow covers rooms, chat, Codex approval, files, terminal, browser, GitHub, handoff, history, and locks", async () => {
  const teamPlan = planTeamCreation("  Core Team  ");
  assert.deepEqual(teamPlan, { name: "Core Team" });

  const roomPlan = planRoomCreation("team-core", "  Desktop app  ", "  /Users/maddiedreese/Documents/MultAIplayer  ");
  assert.deepEqual(roomPlan, {
    teamId: "team-core",
    name: "Desktop app",
    projectPath: "/Users/maddiedreese/Documents/MultAIplayer"
  });

  const host = { id: "github:1", name: "Maddie" };
  const room: ClientRoomRecord = {
    id: "room-desktop",
    teamId: roomPlan.teamId,
    name: roomPlan.name,
    projectPath: roomPlan.projectPath,
    host: host.name,
    hostUserId: host.id,
    hostStatus: "active",
    approvalPolicy: "ask_every_turn",
    approvalDelegationPolicy: "host_only",
    trustedApproverUserIds: [],
    mode: { chat: true, code: true, workspace: true, browser: true },
    codexModel: normalizeCodexModel("gpt-5.4-thinking") ?? "gpt-5.4",
    browserAllowedOrigins: [],
    browserProfilePersistent: true,
    unread: 0
  };

  assert.equal(canUseRoomChat(room), true);
  assert.equal(canStageRoomChatAttachment(room), true);
  assert.equal(canApproveCodexTurn(room, host), true);
  assert.equal(canUseLocalWorkspace(room, host), true);

  const messages: CodexChatMessage[] = [
    { author: "Avery", role: "human", body: "We need to capture onboarding progress.", time: "9:41 AM" },
    { author: "Jordan", role: "human", body: "Track drop-offs by step.", time: "9:42 AM" },
    { author: "Codex", role: "codex", body: "I drafted the first plan.", time: "9:44 AM" },
    {
      author: "Avery",
      role: "human",
      body: "@Codex update the plan and tests.",
      time: "9:45 AM",
      attachments: [
        {
          id: "att-plan",
          name: "docs/checklists/run-18.md",
          type: "code",
          size: 2048,
          content: "# Updated plan\n\n- Add tests"
        }
      ]
    }
  ];

  const approval = buildCodexApprovalSnapshot(
    room,
    messages,
    undefined,
    [{ name: "shell" }],
    [{ url: "http://localhost:5173", status: "approved" }],
    { branch: "main", files: [{ path: "apps/desktop/src/App.tsx", status: "modified", added: 12, removed: 4 }] }
  );
  assert.equal(approval.summary.messagesSinceLastCodex, 1);
  assert.deepEqual(
    approval.summary.attachments.map((attachment) => attachment.name),
    ["docs/checklists/run-18.md"]
  );
  assert.equal(approval.summary.git?.totalFiles, 1);
  assert.deepEqual(approval.summary.browserAccess, ["http://localhost:5173"]);
  assert.deepEqual(approval.summary.terminals, ["shell"]);

  const codexInput = buildCodexTurnInput(messages, room.projectPath, room.codexModel, approval.summary);
  assert.match(codexInput, /Recent chat since the last Codex response/);
  assert.match(codexInput, /docs\/checklists\/run-18\.md/);

  assert.equal(resolveFilePreviewTab("file", false), "file");
  assert.equal(resolveFilePreviewTab("diff", true), "diff");
  assert.equal(resolveFilePreviewTab("diff", false), "file");

  const terminalRequest = {
    id: "term-1",
    requester: "Jordan",
    requesterUserId: "github:2",
    command: " npm test --workspace apps/desktop ",
    cwd: "",
    requestedAt: new Date().toISOString(),
    status: "pending" as const
  };
  assert.equal(canActOnRoomTerminalRequest([terminalRequest], terminalRequest.id), true);
  assert.deepEqual(terminalRequestForApprovedRun(terminalRequest, room.projectPath), {
    ...terminalRequest,
    command: "npm test --workspace apps/desktop",
    cwd: room.projectPath
  });

  assert.equal(canRequestBrowserAccess(room), true);
  assert.equal(canHostBrowserAction(room, host), true);

  const workflow = checkGitHubWorkflowReadiness({
    pushEnabled: true,
    authConfig: { configured: true, provider: "github", scopes: ["repo"] },
    currentUser: { id: host.id, login: "maddiedreese", name: "Maddie" },
    owner: "maddiedreese",
    repo: "multAIplayer",
    head: "codex/alpha-hardening",
    base: "main"
  });
  assert.equal(workflow.ready, true);
  assert.equal(workflow.target, "maddiedreese/multAIplayer:codex/alpha-hardening -> main");

  const actions = checkGitHubActionsReadiness({
    authConfig: { configured: true, provider: "github", scopes: ["repo"] },
    currentUser: { id: host.id, login: "maddiedreese", name: "Maddie" },
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "codex/alpha-hardening"
  });
  assert.equal(actions.ready, true);
  assert.deepEqual(actions.normalizedTarget, {
    owner: "maddiedreese",
    repo: "multAIplayer",
    branch: "codex/alpha-hardening"
  });

  const handoff = {
    version: 1 as const,
    reason: "usage_limit" as const,
    fromHost: "Maddie",
    fromHostUserId: host.id,
    projectPath: room.projectPath,
    codexModel: room.codexModel,
    codexSandboxLevel: "workspace_write" as const,
    approvalPolicy: room.approvalPolicy,
    gitRepoOwner: "maddiedreese",
    gitRepoName: "multAIplayer",
    gitBranch: "main",
    createdAt: new Date().toISOString()
  };
  assert.deepEqual(createHandoffSettingsPatch(handoff), {
    projectPath: room.projectPath,
    codexModel: room.codexModel,
    codexModelPolicy: "pinned",
    codexReasoningEffort: "medium",
    codexReasoningEffortPolicy: "pinned",
    codexRawReasoningEnabled: false,
    codexSpeed: "standard",
    codexServiceTierPolicy: "pinned",
    codexSandboxLevel: "workspace_write",
    approvalPolicy: room.approvalPolicy
  });
  assert.match(hostHandoffDetail(handoff), /out of Codex usage/);

  await saveHistorySettings(room.id, { enabled: true, retentionDays: 30 });
  await saveEncryptedHistory(room.id, { messages, handoffs: [handoff] });
  assert.doesNotMatch(localStorage.dump(), /onboarding progress|docs\/checklists\/run-18\.md|Codex usage/);
  const restored = await loadEncryptedHistory<{ messages: CodexChatMessage[]; handoffs: unknown[] }>(room.id);
  assert.equal(restored?.messages.length, messages.length);
  assert.equal(restored?.handoffs.length, 1);

  assert.equal(canUseRoomChat(room, true), false);
  assert.equal(canStageRoomChatAttachment(room, true), false);
  assert.equal(canApproveCodexTurn(room, host, true), false);
  assert.equal(canUseLocalWorkspace(room, host, true), false);
  assert.equal(canRequestBrowserAccess(room, true), false);
  assert.equal(canHostBrowserAction(room, host, true), false);
});
