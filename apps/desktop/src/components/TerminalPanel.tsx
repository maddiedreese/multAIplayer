import { Check, Copy, MessageSquare, Play, Terminal, X } from "lucide-react";
import type { TerminalLine, TerminalSnapshot } from "../lib/localBackend";
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
  terminalName,
  terminalCommand,
  terminalInput,
  terminalBusy,
  terminalError,
  terminalCommandRisks,
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
  canRequestWorkspace,
  canApproveTerminal,
  onCopyMarkdown,
  onRunGitStatus,
  onOpenInteractiveTerminal,
  onTerminalNameChange,
  onTerminalCommandChange,
  onStartTerminal,
  onRequestTerminalCommand,
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
  return (
    <section className="panel terminal-panel">
      <div className="panel-title">
        <span>Terminals</span>
        <div className="panel-title-actions">
          <button className="primary-tool" onClick={onOpenInteractiveTerminal} disabled={!canReadLocalWorkspace || terminalBusy || !canApproveTerminal}>
            <Terminal size={14} /> Open terminal
          </button>
          <button className="ghost" onClick={onCopyMarkdown} disabled={!canReadLocalWorkspace}>
            <Copy size={14} /> Markdown
          </button>
          <button className="ghost" onClick={onRunGitStatus} disabled={!canReadLocalWorkspace || terminalBusy || !canApproveTerminal}>
            <Play size={14} /> {terminalBusy ? "running" : "git status"}
          </button>
        </div>
      </div>

      <div className="terminal-launcher">
        <div className="tool-panel-hint">
          Start a named foreground shell in this room's project folder, then type into it below.
        </div>
        <input
          value={terminalName}
          onChange={(event) => onTerminalNameChange(event.target.value)}
          placeholder="name"
        />
        <input
          value={terminalCommand}
          onChange={(event) => onTerminalCommandChange(event.target.value)}
          placeholder="command"
        />
        <button
          onClick={onStartTerminal}
          disabled={!canReadLocalWorkspace || terminalBusy || !canApproveTerminal || !terminalName.trim() || !terminalCommand.trim()}
          title="Start terminal"
          aria-label="Start terminal"
        >
          <Play size={14} />
        </button>
        <button
          onClick={onRequestTerminalCommand}
          disabled={!canRequestWorkspace || !terminalCommand.trim()}
          title="Request terminal command"
          aria-label="Request terminal command"
        >
          <MessageSquare size={14} />
        </button>
        {terminalCommandRisks.length > 0 && (
          <InlineSecretWarning
            risks={terminalCommandRisks}
            detail="Review before requesting or running it on the host machine."
            compact
          />
        )}
      </div>

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
        {codexEvents.length === 0 && (
          <div className="empty-state compact">No Codex events in this room.</div>
        )}
      </div>

      <div className="terminal-requests">
        {commandRequests.map((request) => (
          <div className={`terminal-request ${request.status}`} key={request.id}>
            <div>
              <strong>{request.command}</strong>
              <span>{request.requester} · {request.cwd}</span>
            </div>
            <small>{request.status}</small>
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
        {commandRequests.length === 0 && (
          <div className="empty-state compact">No command requests in this room.</div>
        )}
      </div>

      {roomTerminals.length > 0 && (
        <div className="terminal-tabs">
          {roomTerminals.map((terminal) => (
            <button
              key={terminal.id}
              className={terminal.id === selectedTerminalId ? "active" : ""}
              onClick={() => onSelectTerminal(terminal.id)}
            >
              <Terminal size={13} />
              {terminal.name}
              <span>{terminal.running ? "live" : terminal.exitStatus ?? "done"}</span>
            </button>
          ))}
        </div>
      )}

      <div className="terminal-output">
        {terminalRisks.length > 0 && <InlineSecretWarning risks={terminalRisks} compact />}
        {terminalOutputLines.map((line, index) => (
          <div className={`terminal-line ${line.stream} ${line.risks.length ? "sensitive" : ""}`} key={`${line.stream}-${index}-${line.text}`}>
            {line.stream !== "stdout" && <span>{line.stream}</span>}
            {line.text}
          </div>
        ))}
        {codexRunning && <div className="terminal-active">Codex is preparing a foreground terminal...</div>}
        {selectedTerminal && (
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
              value={terminalInput}
              onChange={(event) => onTerminalInputChange(event.target.value)}
              placeholder={selectedTerminal.running ? "type a command" : "terminal stopped"}
              disabled={!selectedTerminalCanControl || !selectedTerminal.running}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </form>
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
            title={`Stop ${selectedTerminal.name}`}
            aria-label={`Stop ${selectedTerminal.name}`}
          >
            <X size={14} />
            Stop
          </button>
        </div>
      )}

      {terminalError && <div className="workflow-message">{terminalError}</div>}
    </section>
  );
}
