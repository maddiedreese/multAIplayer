import React from "react";
import { defaultCodexSandboxLevel, type RoomRecord } from "@multaiplayer/protocol";
import { CodexApprovalCard } from "../../../apps/desktop/src/components/CodexApprovalCard";
import { formatCodexSandboxLevel } from "../../../apps/desktop/src/lib/formatting/appFormatters";
import { canApproveCodexTurn } from "../../../apps/desktop/src/lib/codex/codexApproval";
import {
  formatApprovalAttachments,
  formatApprovalMessages
} from "../../../apps/desktop/src/presentation/codex/codexApprovalSummary";
import { buildHighPrivilegeLabels } from "../../../apps/desktop/src/presentation/containers/containerPropBuilders";
import {
  buildCodexApprovalSnapshot,
  buildCodexTurnInput,
  maxCodexTurnInputChars,
  messagesSinceLastCodex,
  type CodexApprovalSnapshot
} from "../../../apps/desktop/src/lib/codex/codexTurn";
import type { ChatMessage } from "../../../apps/desktop/src/types";
import "./codex-turn-approval.css";

export const description =
  "Real Codex approval card and bounded context builders with deterministic member/host UI transitions.";
export const mockedBoundaries = ["encrypted room-event delivery", "native Codex app-server execution"] as const;

const host = { id: "github:host", name: "Maddie" };
const member = { id: "github:member", name: "Avery" };
const room: RoomRecord = {
  id: "room-codex-e2e",
  teamId: "team-e2e",
  name: "Codex approval UI",
  projectPath: "/tmp/multaiplayer-e2e",
  host: host.name,
  hostUserId: host.id,
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  mode: { chat: true, code: true, workspace: true, browser: true },
  codexModel: "gpt-5.4",
  codexSandboxLevel: "workspace_write",
  browserProfilePersistent: true,
  unread: 0
};

const messages: ChatMessage[] = [
  { id: "codex-prior", author: "Codex", role: "codex", body: "Earlier turn complete.", time: "9:00 AM" },
  ...Array.from({ length: 8 }, (_, index): ChatMessage => ({
    id: `member-${index + 1}`,
    author: index % 2 === 0 ? "Avery" : "Jordan",
    role: "human",
    body:
      index === 0
        ? "OLDEST-CONTEXT-MARKER should be counted but omitted from the six-message approval preview."
        : index === 7
          ? "NEWEST-CONTEXT-MARKER implement the reviewed onboarding change."
          : `Room proposal context ${index + 1}.`,
    time: `9:${String(index + 1).padStart(2, "0")} AM`,
    attachments: Array.from({ length: index < 2 ? 2 : 1 }, (_, attachmentIndex) => ({
      id: `attachment-${index + 1}-${attachmentIndex + 1}`,
      name:
        index === 0 && attachmentIndex === 0
          ? "oldest-hidden-context.txt"
          : index === 7
            ? "newest-visible-context.md"
            : `review-context-${index + 1}-${attachmentIndex + 1}.md`,
      type: "text/markdown",
      size: 1024 + index,
      content: `Bounded attachment material ${index + 1}.${attachmentIndex + 1}`
    }))
  }))
];

type Phase = "idle" | "pending" | "running" | "completed" | "denied";

export default function CodexApprovalScenario() {
  const [actor, setActor] = React.useState<"member" | "host">("member");
  const [approval, setApproval] = React.useState<CodexApprovalSnapshot<ChatMessage> | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [executionCount, setExecutionCount] = React.useState(0);
  const [boundedInputLength, setBoundedInputLength] = React.useState<number | null>(null);
  const completionTimer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    },
    []
  );

  const localUser = actor === "host" ? host : member;
  const canApprove = canApproveCodexTurn(room, localUser);
  const visibleMessages = messagesSinceLastCodex(approval?.messages ?? messages) as ChatMessage[];
  const summary = approval?.summary;

  function proposeTurn() {
    const snapshot = buildCodexApprovalSnapshot(
      room,
      messages,
      undefined,
      [{ name: "shared-shell" }],
      [{ url: "https://docs.example.com/review", status: "approved" }],
      {
        branch: "codex/approval-e2e",
        files: [{ path: "apps/desktop/src/App.tsx", status: "modified", added: 4, removed: 1 }]
      }
    );
    setApproval(snapshot);
    setPhase("pending");
    setBoundedInputLength(null);
  }

  function approveTurn() {
    if (!approval || !canApprove) return;
    const input = buildCodexTurnInput(approval.messages, room.projectPath, room.codexModel, approval.summary);
    setBoundedInputLength(input.length);
    setExecutionCount((count) => count + 1);
    setPhase("running");
    completionTimer.current = window.setTimeout(() => {
      setApproval(null);
      setPhase("completed");
    }, 400);
  }

  function denyTurn() {
    if (!approval || !canApprove) return;
    setApproval(null);
    setPhase("denied");
  }

  return (
    <section className="codex-approval-scenario" aria-label="Codex turn approval scenario">
      <header>
        <div>
          <p className="eyebrow">Room member proposal → active-host decision</p>
          <h1>Codex turn approval</h1>
        </div>
        <div className="actor-switch" role="group" aria-label="Local user role">
          <button className={actor === "member" ? "primary" : "secondary"} onClick={() => setActor("member")}>
            Member view
          </button>
          <button className={actor === "host" ? "primary" : "secondary"} onClick={() => setActor("host")}>
            Active host view
          </button>
        </div>
      </header>

      <div className="scenario-status" aria-live="polite">
        <strong data-testid="approval-phase">{phase}</strong>
        <span>{actor === "host" ? "Maddie is the active host." : "Avery is a room member."}</span>
        <span data-testid="execution-count">Native execution requests: {executionCount}</span>
      </div>

      {phase === "idle" || phase === "completed" || phase === "denied" ? (
        <button className="primary propose-turn" onClick={proposeTurn}>
          Propose Codex turn as Avery
        </button>
      ) : null}

      {phase === "pending" && approval && summary ? (
        <>
          <p data-testid="proposal-notice">Avery proposed a Codex turn for active-host approval.</p>
          <CodexApprovalCard
            summary={{
              messages: formatApprovalMessages(visibleMessages),
              attachments: formatApprovalAttachments(visibleMessages),
              sandbox: formatCodexSandboxLevel(room.codexSandboxLevel ?? defaultCodexSandboxLevel),
              highPrivilegeLabels: buildHighPrivilegeLabels(summary, room.codexSandboxLevel),
              riskFlags: approval.riskFlags ?? []
            }}
            isActiveHost={actor === "host"}
            codexRunning={false}
            canApprove={canApprove}
            onApprove={approveTurn}
            onDeny={denyTurn}
          />
        </>
      ) : null}

      {phase === "running" ? <p className="execution-state">Approved Codex execution is running…</p> : null}
      {phase === "completed" ? <p className="execution-state success">Codex execution completed.</p> : null}
      {phase === "denied" ? <p className="execution-state denied">Codex proposal denied without execution.</p> : null}
      {boundedInputLength !== null ? (
        <p data-testid="codex-input-bound">
          Bounded Codex input: {boundedInputLength} / {maxCodexTurnInputChars} characters
        </p>
      ) : null}
    </section>
  );
}
