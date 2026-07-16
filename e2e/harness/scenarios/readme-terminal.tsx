import React from "react";
import { TerminalPanel } from "../../../apps/desktop/src/components/TerminalPanel";
import type { TerminalSnapshot } from "../../../apps/desktop/src/lib/platform/localBackend";

export const description = "The production room-terminal panel renders a live host-controlled shell in dark mode.";
export const mockedBoundaries = ["native PTY process", "room terminal event delivery"] as const;

const terminal: TerminalSnapshot = {
  id: "readme-terminal",
  roomId: "northstar",
  name: "Shell",
  cwd: "~/Projects/northstar",
  command: "zsh",
  running: true,
  exitStatus: null,
  startedAt: "2026-07-15T18:00:00.000Z",
  lines: []
};

const noop = () => undefined;

export default function ReadmeTerminalScenario() {
  return (
    <section className="readme-terminal-surface" data-readme-capture aria-label="Room terminal feature">
      <TerminalPanel
        terminalBusy={false}
        terminalError={null}
        terminalRisks={[]}
        codexEvents={[]}
        commandRequests={[]}
        roomTerminals={[terminal]}
        selectedTerminal={terminal}
        selectedTerminalId={terminal.id}
        selectedTerminalCanControl
        selectedTerminalCanRestart
        codexRunning={false}
        canReadLocalWorkspace
        canApproveTerminal
        onCopyMarkdown={noop}
        onOpenInteractiveTerminal={noop}
        onApproveTerminalRequest={noop}
        onDenyTerminalRequest={noop}
        onSelectTerminal={noop}
        onSendTerminalData={noop}
        onRestartTerminal={noop}
        onStopTerminal={noop}
        onRevokeExactCommandGrants={noop}
      />
    </section>
  );
}
