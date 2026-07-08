import { Check, Copy, Plus, Play, Square, Terminal, X } from "lucide-react";
import { useRef } from "react";
import type { TerminalLine, TerminalSnapshot } from "../lib/localBackend";
import { stripTerminalControlSequences } from "../lib/terminalText";
import { InlineSecretWarning } from "./common";

export interface TerminalCommandRequestDisplay {
  id: string;
  command: string;
  requester: string;
  cwd: string;
  status: "pending" | "approved" | "denied";
  risks: string[];
}

export interface CodexEventDisplay {
  key: string;
  status: "started" | "completed" | "failed" | "event";
  statusLabel: string;
  message: string;
  detail: string;
  host: string;
}

export interface TerminalOutputLineDisplay extends TerminalLine {
  risks: string[];
}

export function TerminalPanel({
  terminalInput,
  terminalBusy,
  terminalError,
  terminalRisks,
  codexEvents,
  commandRequests,
  roomTerminals,
  selectedTerminal,
  selectedTerminalId,
  selectedTerminalCanControl,
  selectedTerminalCanRestart,
  terminalOutputLines,
  codexRunning,
  canReadLocalWorkspace,
  canApproveTerminal,
  onCopyMarkdown,
  onOpenInteractiveTerminal,
  onApproveTerminalRequest,
  onDenyTerminalRequest,
  onSelectTerminal,
  onTerminalInputChange,
  onSendTerminalInput,
  onRestartTerminal,
  onStopTerminal
}: {
  terminalName: string;
  terminalCommand: string;
  terminalInput: string;
  terminalBusy: boolean;
  terminalError: string | null;
  terminalCommandRisks: string[];
  terminalRisks: string[];
  codexEvents: CodexEventDisplay[];
  commandRequests: TerminalCommandRequestDisplay[];
  roomTerminals: TerminalSnapshot[];
  selectedTerminal: TerminalSnapshot | null;
  selectedTerminalId: string | null;
  selectedTerminalCanControl: boolean;
  selectedTerminalCanRestart: boolean;
  terminalOutputLines: TerminalOutputLineDisplay[];
  codexRunning: boolean;
  canReadLocalWorkspace: boolean;
  canRequestWorkspace: boolean;
  canApproveTerminal: boolean;
  onCopyMarkdown: () => void;
  onRunGitStatus: () => void;
  onOpenInteractiveTerminal: () => void;
  onTerminalNameChange: (name: string) => void;
  onTerminalCommandChange: (command: string) => void;
  onStartTerminal: () => void;
  onRequestTerminalCommand: () => void;
  onApproveTerminalRequest: (requestId: string) => void;
  onDenyTerminalRequest: (requestId: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  onTerminalInputChange: (input: string) => void;
  onSendTerminalInput: () => void;
  onRestartTerminal: () => void;
  onStopTerminal: () => void;
}) {
  const terminalInputRef = useRef<HTMLInputElement | null>(null);
  const visibleTerminalLines = terminalOutputLines.filter(
    (line) => !(line.stream === "system" && line.text.trim() === "$ exec zsh -f")
  );

  return (
    <section className="panel terminal-panel">
      <div className="panel-title">
        <span>Terminals</span>
        <div className="panel-title-actions">
          <button className="primary-tool" onClick={onOpenInteractiveTerminal} disabled={!canReadLocalWorkspace || terminalBusy || !canApproveTerminal}>
            <Plus size={14} /> New terminal
          </button>
          <button className="ghost" onClick={onCopyMarkdown} disabled={!canReadLocalWorkspace}>
            <Copy size={14} /> Markdown
          </button>
        </div>
      </div>

      {(codexEvents.length > 0 || commandRequests.length > 0) && (
        <div className="terminal-requests">
          {codexEvents.map((event) => (
            <div className={`terminal-request ${event.status === "failed" ? "denied" : event.status === "completed" ? "approved" : "pending"}`} key={event.key}>
              <div>
                <strong>{event.statusLabel}</strong>
                <span>{event.message}</span>
                <small>{event.detail}</small>
              </div>
              <small>{event.host}</small>
            </div>
          ))}
          {commandRequests.map((request) => (
            <div className={`terminal-request ${request.status}`} key={request.id}>
              <div>
                <strong>{request.command}</strong>
                <span>{request.requester} · {request.cwd}</span>
              </div>
              <small>{request.status}</small>
              {request.status === "pending" && (
                <div className="terminal-request-warning">
                  <InlineSecretWarning
                    risks={["Approving runs this shell command on the host account, not inside a project sandbox."]}
                    compact
                  />
                </div>
              )}
              {request.status === "pending" && (
                <div>
                  <button
                    onClick={() => onApproveTerminalRequest(request.id)}
                    disabled={!canApproveTerminal || terminalBusy}
                    title={`Approve ${request.command}`}
                    aria-label={`Approve ${request.command}`}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => onDenyTerminalRequest(request.id)}
                    disabled={!canApproveTerminal || terminalBusy}
                    title={`Deny ${request.command}`}
                    aria-label={`Deny ${request.command}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {request.risks.length > 0 && (
                <div className="terminal-request-warning">
                  <InlineSecretWarning
                    risks={request.risks}
                    detail="Review before approving this command on the host machine."
                    compact
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {roomTerminals.length > 0 && (
        <div className="terminal-tabs">
          {roomTerminals.map((terminal) => (
            <div
              key={terminal.id}
              className={`terminal-tab ${terminal.id === selectedTerminalId ? "active" : ""}`}
            >
              <button
                type="button"
                className="terminal-tab-select"
                onClick={() => onSelectTerminal(terminal.id)}
              >
                <Terminal size={13} />
                {terminal.name}
              </button>
              <span>{terminal.running ? "live" : terminal.exitStatus ?? "done"}</span>
              {terminal.id === selectedTerminalId && (
                <button
                  type="button"
                  className="terminal-tab-close"
                  onClick={onStopTerminal}
                  disabled={!selectedTerminalCanControl || !terminal.running || terminalBusy}
                  title={`Close ${terminal.name}`}
                  aria-label={`Close ${terminal.name}`}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="terminal-output" onClick={() => terminalInputRef.current?.focus()}>
        {terminalRisks.length > 0 && <InlineSecretWarning risks={terminalRisks} compact />}
        {visibleTerminalLines.map((line, index) => (
          <div className={`terminal-line ${line.stream} ${line.risks.length ? "sensitive" : ""}`} key={`${line.stream}-${index}-${line.text}`}>
            {line.stream !== "stdout" && <span>{line.stream}</span>}
            {stripTerminalControlSequences(line.text)}
          </div>
        ))}
        {codexRunning && <div className="terminal-active">Codex is preparing a foreground terminal...</div>}
        {selectedTerminal ? (
          <form
            className="terminal-command-line"
            onSubmit={(event) => {
              event.preventDefault();
              onSendTerminalInput();
            }}
          >
            <span>{selectedTerminal.name}</span>
            <b>$</b>
            <input
              ref={terminalInputRef}
              value={terminalInput}
              onChange={(event) => onTerminalInputChange(event.target.value)}
              placeholder={selectedTerminal.running ? "type a command" : "terminal stopped"}
              disabled={!selectedTerminalCanControl || !selectedTerminal.running}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </form>
        ) : (
          <div className="terminal-active">Opening shell...</div>
        )}
      </div>

      {selectedTerminal && (
        <div className="terminal-session-actions">
          {selectedTerminalCanRestart && (
            <button
              onClick={onRestartTerminal}
              disabled={!selectedTerminalCanControl || terminalBusy}
              title={`Restart ${selectedTerminal.name}`}
            >
              <Play size={14} />
              Restart
            </button>
          )}
          <button
            onClick={onStopTerminal}
            disabled={!selectedTerminalCanControl || !selectedTerminal.running || terminalBusy}
            title={`Close ${selectedTerminal.name}`}
            aria-label={`Close ${selectedTerminal.name}`}
          >
            <Square size={14} />
            Close
          </button>
        </div>
      )}

      {terminalError && <div className="workflow-message">{terminalError}</div>}
    </section>
  );
}
