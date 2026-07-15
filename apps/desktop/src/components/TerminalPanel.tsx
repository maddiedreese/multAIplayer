import { FitAddon } from "@xterm/addon-fit";
import * as xtermModule from "@xterm/xterm";
import { Check, Copy, Maximize2, Minimize2, Plus, Play, Square, Terminal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminalLine, TerminalSnapshot } from "../lib/platform/localBackend";
import { InlineSecretWarning } from "./common";
import { reportExpectedFailure } from "../lib/core/nonFatalReporting";

type XTermConstructor = typeof import("@xterm/xterm").Terminal;
const xtermCompat = xtermModule as unknown as {
  Terminal?: XTermConstructor;
  default?: { Terminal: XTermConstructor };
};
const XTerm = xtermCompat.Terminal ?? xtermCompat.default?.Terminal;
type XTermInstance = InstanceType<XTermConstructor>;

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
  codexRunning,
  canReadLocalWorkspace,
  canApproveTerminal,
  onCopyMarkdown,
  onOpenInteractiveTerminal,
  onApproveTerminalRequest,
  onDenyTerminalRequest,
  onSelectTerminal,
  onSendTerminalData,
  onRestartTerminal,
  onStopTerminal,
  onRevokeExactCommandGrants
}: {
  terminalBusy: boolean;
  terminalError: string | null;
  terminalRisks: string[];
  codexEvents: CodexEventDisplay[];
  commandRequests: TerminalCommandRequestDisplay[];
  roomTerminals: TerminalSnapshot[];
  selectedTerminal: TerminalSnapshot | null;
  selectedTerminalId: string | null;
  selectedTerminalCanControl: boolean;
  selectedTerminalCanRestart: boolean;
  codexRunning: boolean;
  canReadLocalWorkspace: boolean;
  canApproveTerminal: boolean;
  onCopyMarkdown: () => void;
  onOpenInteractiveTerminal: () => void;
  onApproveTerminalRequest: (requestId: string) => void;
  onDenyTerminalRequest: (requestId: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSendTerminalData: (input: string) => void;
  onRestartTerminal: () => void;
  onStopTerminal: () => void;
  onRevokeExactCommandGrants: () => void;
}) {
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalPanelRef = useRef<HTMLElement | null>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const selectedTerminalIdForEffect = selectedTerminal?.id ?? null;
  const selectedTerminalRunningForEffect = selectedTerminal?.running ?? false;
  const terminalControlRef = useRef({
    canControl: selectedTerminalCanControl,
    running: selectedTerminalRunningForEffect,
    sendData: onSendTerminalData
  });
  const renderedTerminalIdRef = useRef<string | null>(null);
  const renderedLineCountRef = useRef(0);

  useEffect(() => {
    terminalControlRef.current = {
      canControl: selectedTerminalCanControl,
      running: selectedTerminalRunningForEffect,
      sendData: onSendTerminalData
    };
  }, [onSendTerminalData, selectedTerminalCanControl, selectedTerminalRunningForEffect]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 16);
      window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    }
    if (!XTerm) return;
    const terminalFont =
      window.getComputedStyle?.(document.documentElement).getPropertyValue("--font-mono").trim() ||
      '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    const xterm = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: terminalFont,
      fontSize: 13,
      lineHeight: 1.35,
      theme: readTerminalTheme()
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    const dataDisposable = xterm.onData((data: string) => {
      const control = terminalControlRef.current;
      if (!control.canControl || !control.running) return;
      control.sendData(data);
    });
    let fitFrame: number | null = null;
    const scheduleFit = () => {
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        try {
          fitAddon.fit();
        } catch {
          // The addon can throw while the panel is hidden or has no measurable width.
          reportExpectedFailure("terminal fit skipped for a hidden or unmeasurable panel");
        }
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleFit);
    resizeObserver?.observe(host);
    const themeObserver =
      typeof window.MutationObserver === "undefined"
        ? null
        : new window.MutationObserver(() => {
            xterm.options.theme = readTerminalTheme();
          });
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    scheduleFit();
    const initialFocusFrame = window.requestAnimationFrame(() => xterm.focus());

    return () => {
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      window.cancelAnimationFrame(initialFocusFrame);
      dataDisposable.dispose();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      renderedTerminalIdRef.current = null;
      renderedLineCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    if (!selectedTerminal) {
      xterm.clear();
      renderedTerminalIdRef.current = null;
      renderedLineCountRef.current = 0;
      return;
    }

    if (renderedTerminalIdRef.current !== selectedTerminal.id) {
      xterm.reset();
      renderedTerminalIdRef.current = selectedTerminal.id;
      renderedLineCountRef.current = 0;
    }

    const newLines = selectedTerminal.lines.slice(renderedLineCountRef.current);
    for (const line of newLines) {
      writeTerminalLine(xterm, line);
    }
    renderedLineCountRef.current = selectedTerminal.lines.length;
    try {
      fitAddonRef.current?.fit();
    } catch {
      // Hidden panels are fitted again when visible.
      reportExpectedFailure("terminal fit deferred until the panel is visible");
    }
  }, [selectedTerminal, selectedTerminal?.lines.length, selectedTerminalIdForEffect]);

  useEffect(() => {
    if (!selectedTerminalIdForEffect) return;
    const focusFrame = window.requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Hidden panels are fitted again when visible.
        reportExpectedFailure("terminal focus fit deferred until the panel is visible");
      }
      const activeElement = document.activeElement;
      if (
        !activeElement ||
        activeElement === document.body ||
        activeElement === document.documentElement ||
        terminalPanelRef.current?.contains(activeElement)
      ) {
        xtermRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [selectedTerminalIdForEffect]);

  return (
    <section className={`panel terminal-panel ${terminalExpanded ? "expanded" : ""}`} ref={terminalPanelRef}>
      <TerminalPanelTitle
        {...{
          canReadLocalWorkspace,
          terminalBusy,
          canApproveTerminal,
          terminalExpanded,
          onOpenInteractiveTerminal,
          onCopyMarkdown,
          onRevokeExactCommandGrants
        }}
        onToggleExpanded={() => setTerminalExpanded((current) => !current)}
      />

      <TerminalRequests
        {...{
          codexEvents,
          commandRequests,
          canApproveTerminal,
          terminalBusy,
          onApproveTerminalRequest,
          onDenyTerminalRequest
        }}
      />

      <TerminalTabs
        {...{
          roomTerminals,
          selectedTerminalId,
          onSelectTerminal,
          onStopTerminal,
          selectedTerminalCanControl,
          terminalBusy
        }}
      />

      <div
        className="terminal-output xterm-output"
        onClick={() => xtermRef.current?.focus()}
        aria-label="Interactive terminal"
      >
        {terminalRisks.length > 0 && <InlineSecretWarning risks={terminalRisks} compact />}
        <div className="xterm-host" ref={terminalHostRef} />
        {codexRunning && <div className="terminal-active">Codex is preparing a foreground terminal...</div>}
        {!selectedTerminal && <div className="terminal-active">Opening shell...</div>}
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

function TerminalRequests({
  codexEvents,
  commandRequests,
  canApproveTerminal,
  terminalBusy,
  onApproveTerminalRequest,
  onDenyTerminalRequest
}: {
  codexEvents: CodexEventDisplay[];
  commandRequests: TerminalCommandRequestDisplay[];
  canApproveTerminal: boolean;
  terminalBusy: boolean;
  onApproveTerminalRequest: (id: string) => void;
  onDenyTerminalRequest: (id: string) => void;
}) {
  if (!codexEvents.length && !commandRequests.length) return null;
  return (
    <div className="terminal-requests">
      {codexEvents.map((event) => (
        <div
          className={`terminal-request ${event.status === "failed" ? "denied" : event.status === "completed" ? "approved" : "pending"}`}
          key={event.key}
        >
          <div>
            <strong>{event.statusLabel}</strong>
            <span>{event.message}</span>
            <small>{event.detail}</small>
          </div>
          <small>{event.host}</small>
        </div>
      ))}
      {commandRequests.map((request) => (
        <TerminalCommandRequest
          key={request.id}
          {...{ request, canApproveTerminal, terminalBusy, onApproveTerminalRequest, onDenyTerminalRequest }}
        />
      ))}
    </div>
  );
}

function TerminalPanelTitle({
  canReadLocalWorkspace,
  terminalBusy,
  canApproveTerminal,
  terminalExpanded,
  onOpenInteractiveTerminal,
  onCopyMarkdown,
  onRevokeExactCommandGrants,
  onToggleExpanded
}: {
  canReadLocalWorkspace: boolean;
  terminalBusy: boolean;
  canApproveTerminal: boolean;
  terminalExpanded: boolean;
  onOpenInteractiveTerminal: () => void;
  onCopyMarkdown: () => void;
  onRevokeExactCommandGrants: () => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div className="panel-title">
      <span>Terminals</span>
      <div className="panel-title-actions">
        <button
          className="primary-tool"
          onClick={onOpenInteractiveTerminal}
          disabled={!canReadLocalWorkspace || terminalBusy || !canApproveTerminal}
        >
          <Plus size={14} /> New terminal
        </button>
        <button className="ghost" onClick={onCopyMarkdown} disabled={!canReadLocalWorkspace}>
          <Copy size={14} /> Markdown
        </button>
        <button className="ghost" onClick={onRevokeExactCommandGrants} disabled={!canApproveTerminal || terminalBusy}>
          <X size={14} /> Revoke repeats
        </button>
        <button
          className="ghost icon-only terminal-expand-button"
          onClick={onToggleExpanded}
          aria-label={terminalExpanded ? "Return terminal to column" : "Expand terminal"}
        >
          {terminalExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </div>
  );
}

function TerminalTabs({
  roomTerminals,
  selectedTerminalId,
  onSelectTerminal,
  onStopTerminal,
  selectedTerminalCanControl,
  terminalBusy
}: {
  roomTerminals: TerminalSnapshot[];
  selectedTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onStopTerminal: () => void;
  selectedTerminalCanControl: boolean;
  terminalBusy: boolean;
}) {
  if (!roomTerminals.length) return null;
  return (
    <div className="terminal-tabs">
      {roomTerminals.map((terminal) => {
        const selected = terminal.id === selectedTerminalId;
        return (
          <div key={terminal.id} className={`terminal-tab ${selected ? "active" : ""}`}>
            <button type="button" className="terminal-tab-select" onClick={() => onSelectTerminal(terminal.id)}>
              <Terminal size={13} />
              {terminal.name}
            </button>
            <span>{terminal.running ? "live" : (terminal.exitStatus ?? "done")}</span>
            {selected && (
              <button
                type="button"
                className="terminal-tab-close"
                onClick={onStopTerminal}
                disabled={!selectedTerminalCanControl || !terminal.running || terminalBusy}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TerminalCommandRequest({
  request,
  canApproveTerminal,
  terminalBusy,
  onApproveTerminalRequest,
  onDenyTerminalRequest
}: {
  request: TerminalCommandRequestDisplay;
  canApproveTerminal: boolean;
  terminalBusy: boolean;
  onApproveTerminalRequest: (id: string) => void;
  onDenyTerminalRequest: (id: string) => void;
}) {
  const pending = request.status === "pending";
  return (
    <div className={`terminal-request ${request.status}`}>
      <div>
        <strong>{request.command}</strong>
        <span>
          {request.requester} · {request.cwd}
        </span>
      </div>
      <small>{request.status}</small>
      {pending && (
        <div className="terminal-request-warning">
          <InlineSecretWarning
            risks={["Approving runs this shell command on the host account, not inside a project sandbox."]}
            compact
          />
        </div>
      )}
      {pending && (
        <div>
          <button onClick={() => onApproveTerminalRequest(request.id)} disabled={!canApproveTerminal || terminalBusy}>
            <Check size={13} />
          </button>
          <button onClick={() => onDenyTerminalRequest(request.id)} disabled={!canApproveTerminal || terminalBusy}>
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
  );
}

function writeTerminalLine(terminal: XTermInstance, line: TerminalLine) {
  if (line.stream === "stdin") return;
  if (line.stream === "system") {
    if (line.text.trim() === "$ exec zsh -f") return;
    terminal.writeln(line.text);
    return;
  }
  terminal.write(line.text);
}

function readTerminalTheme() {
  const rootStyles = window.getComputedStyle?.(document.documentElement);
  const foreground = rootStyles?.getPropertyValue("--code-text").trim() || "#111111";
  return {
    background: rootStyles?.getPropertyValue("--code-bg").trim() || "#fafafa",
    foreground,
    cursor: foreground,
    selectionBackground: "rgba(120, 120, 120, 0.3)"
  };
}
