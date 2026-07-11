import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, Check, KeyRound, X } from "lucide-react";
import {
  listCodexServerRequests,
  respondCodexServerRequest,
  type CodexServerRequest,
  type CodexServerResponse
} from "../lib/localBackend";
import { isTauriRuntime } from "../lib/localBackend/runtime";

interface ResolvedRequestEvent {
  requestKey: string;
  roomId: string;
}

const interactiveMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "tool/requestUserInput",
  "mcpServer/elicitation/request",
  "applyPatchApproval",
  "execCommandApproval"
]);

export function CodexServerRequestDialog({
  selectedRoomId,
  canRespond
}: {
  selectedRoomId: string;
  canRespond: boolean;
}) {
  const [requests, setRequests] = useState<CodexServerRequest[]>([]);
  const [answers, setAnswers] = useState<Record<string, CodexRequestAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let active = true;
    const addRequest = (request: CodexServerRequest) => {
      if (!interactiveMethods.has(request.method)) {
        void respondCodexServerRequest(request.requestKey, {
          error: { code: -32601, message: "This app-server request is not supported by multAIplayer." }
        });
        return;
      }
      setRequests((current) =>
        current.some((item) => item.requestKey === request.requestKey) ? current : [...current, request]
      );
    };
    const removeRequest = (requestKey: string) => {
      setRequests((current) => current.filter((item) => item.requestKey !== requestKey));
    };
    const subscriptions = Promise.all([
      listen<CodexServerRequest>("codex://server-request", (event) => addRequest(event.payload)),
      listen<ResolvedRequestEvent>("codex://server-request-resolved", (event) =>
        removeRequest(event.payload.requestKey)
      )
    ]);
    void listCodexServerRequests()
      .then((pending) => {
        if (active) pending.forEach(addRequest);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      void subscriptions.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, []);

  const request = requests.find((item) => item.roomId === selectedRoomId) ?? null;
  const display = useMemo(() => (request ? describeCodexServerRequest(request) : null), [request]);
  useEffect(() => {
    setAnswers({});
    setError(null);
  }, [request?.requestKey]);
  if (!request || !display) {
    const backgroundCount = requests.filter((item) => item.roomId !== selectedRoomId).length;
    return backgroundCount ? (
      <div className="codex-background-request-indicator" role="status">
        <KeyRound size={14} /> {backgroundCount} Codex request{backgroundCount === 1 ? "" : "s"} waiting in other rooms
      </div>
    ) : null;
  }

  async function resolve(response: CodexServerResponse) {
    setBusy(true);
    setError(null);
    try {
      await respondCodexServerRequest(request!.requestKey, response);
      setRequests((current) => current.filter((item) => item.requestKey !== request!.requestKey));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal codex-server-request-dialog" role="dialog" aria-modal="true" aria-label={display.title}>
        <div className="approval-title">
          <div>
            <KeyRound size={18} />
            <strong>{display.title}</strong>
          </div>
        </div>
        <p>{display.message}</p>
        <div className="approval-grid codex-request-provenance">
          <div className="approval-item">
            <span>Proposed by</span>
            <strong>{request.proposedBy ?? "Unknown Codex turn source"}</strong>
          </div>
          <div className="approval-item">
            <span>Context supplied</span>
            <strong>{request.contextSummary ?? "No provenance summary was supplied; decline if unexpected."}</strong>
          </div>
        </div>
        {display.detail && <pre className="codex-request-detail">{display.detail}</pre>}
        {display.url && (
          <a className="codex-request-url" href={display.url} target="_blank" rel="noreferrer noopener">
            Open authentication page
          </a>
        )}
        {display.questions.map((question) => (
          <label key={question.id}>
            <span>{question.label}</span>
            {question.kind === "boolean" ? (
              <input
                type="checkbox"
                checked={answers[question.id] === true}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.checked }))}
              />
            ) : question.kind === "select" ? (
              <select
                value={typeof answers[question.id] === "string" ? (answers[question.id] as string) : ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              >
                <option value="">Select…</option>
                {question.options.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : question.kind === "multiselect" ? (
              <select
                multiple
                value={Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : []}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: Array.from(event.target.selectedOptions, (option) => option.value)
                  }))
                }
              >
                {question.options.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={question.secret ? "password" : question.kind === "number" ? "number" : "text"}
                value={typeof answers[question.id] === "string" ? (answers[question.id] as string) : ""}
                min={question.min}
                max={question.max}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                autoComplete="off"
              />
            )}
          </label>
        ))}
        {!canRespond && (
          <div className="approval-risk-item">
            <AlertTriangle size={14} /> Only the active host can answer this request.
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="approval-actions">
          <button className="secondary" disabled={busy || !canRespond} onClick={() => void resolve(display.decline)}>
            <X size={15} /> Decline
          </button>
          <button
            className="primary"
            disabled={busy || !canRespond || !display.canAccept(answers)}
            onClick={() => void resolve(display.accept(answers))}
          >
            <Check size={15} /> {busy ? "Responding…" : "Accept"}
          </button>
        </div>
      </section>
    </div>
  );
}

export interface CodexServerRequestDisplay {
  title: string;
  message: string;
  detail: string | null;
  url: string | null;
  questions: CodexRequestQuestion[];
  decline: CodexServerResponse;
  accept: (answers: Record<string, CodexRequestAnswer>) => CodexServerResponse;
  canAccept: (answers: Record<string, CodexRequestAnswer>) => boolean;
}

export type CodexRequestAnswer = string | boolean | string[];

export interface CodexRequestQuestion {
  id: string;
  label: string;
  secret: boolean;
  required: boolean;
  kind: "text" | "number" | "boolean" | "select" | "multiselect";
  options: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  integer?: boolean;
}

export function describeCodexServerRequest(request: CodexServerRequest): CodexServerRequestDisplay {
  const params = asRecord(request.params);
  const reason = text(params.reason) ?? text(params.message);
  const base = {
    url: null,
    questions: [],
    canAccept: () => true
  };
  if (request.method.includes("commandExecution") || request.method === "execCommandApproval") {
    const legacy = request.method === "execCommandApproval";
    return {
      ...base,
      title: "Approve Codex command",
      message: reason ?? "Codex is requesting permission to run a command on this host.",
      detail: formatCommand(params.command, params.cwd),
      decline: { result: { decision: legacy ? "denied" : "decline" } },
      accept: () => ({ result: { decision: legacy ? "approved" : "accept" } })
    };
  }
  if (request.method.includes("fileChange") || request.method === "applyPatchApproval") {
    const legacy = request.method === "applyPatchApproval";
    return {
      ...base,
      title: "Approve Codex file change",
      message: reason ?? "Codex is requesting permission to change files in this workspace.",
      detail: text(params.grantRoot),
      decline: { result: { decision: legacy ? "denied" : "decline" } },
      accept: () => ({ result: { decision: legacy ? "approved" : "accept" } })
    };
  }
  if (request.method === "item/permissions/requestApproval") {
    return {
      ...base,
      title: "Approve additional permissions",
      message: reason ?? "Codex is requesting additional host permissions for this turn.",
      detail: null,
      decline: { result: { permissions: {}, scope: "turn" } },
      accept: () => ({ result: { permissions: asRecord(params.permissions), scope: "turn" } })
    };
  }
  if (request.method.includes("requestUserInput")) {
    const questions = Array.isArray(params.questions)
      ? params.questions.slice(0, 3).flatMap((value) => {
          const question = asRecord(value);
          const id = text(question.id);
          const options = Array.isArray(question.options)
            ? question.options.flatMap((value) => {
                const option = asRecord(value);
                const label = text(option.label);
                return label ? [{ value: label, label }] : [];
              })
            : [];
          return id
            ? [
                {
                  id,
                  label: text(question.question) ?? text(question.header) ?? "Codex question",
                  secret: question.isSecret === true,
                  required: true,
                  kind: options.length ? ("select" as const) : ("text" as const),
                  options
                }
              ]
            : [];
        })
      : [];
    return {
      title: "Codex needs input",
      message: reason ?? "Answer the following question to continue the turn.",
      detail: null,
      url: null,
      questions,
      decline: { error: { code: -32000, message: "The user cancelled this input request." } },
      accept: (values) => ({
        result: {
          answers: Object.fromEntries(
            questions.map(({ id }) => [
              id,
              {
                answers: [typeof values[id] === "string" ? values[id] : ""]
              }
            ])
          )
        }
      }),
      canAccept: (values) => questions.every(({ id }) => typeof values[id] === "string" && values[id].trim().length > 0)
    };
  }
  const elicitation = asRecord(params.request ?? params);
  if (text(elicitation.mode) === "url") {
    const url = safeWebUrl(elicitation.url);
    return {
      ...base,
      title: "Authenticate Codex integration",
      message: text(elicitation.message) ?? reason ?? "An MCP integration needs authentication to continue.",
      detail: null,
      url,
      decline: { result: { action: "decline", content: null } },
      accept: () => ({ result: { action: "accept", content: null } }),
      canAccept: () => Boolean(url)
    };
  }
  const form = describeMcpForm(elicitation);
  return {
    title: "Codex integration needs input",
    message: text(elicitation.message) ?? reason ?? "An MCP integration needs confirmation to continue.",
    detail: null,
    url: null,
    questions: form.questions,
    decline: { result: { action: "decline", content: null } },
    accept: (values) => ({ result: { action: "accept", content: form.content(values) } }),
    canAccept: form.canAccept
  };
}

function describeMcpForm(params: Record<string, unknown>): {
  questions: CodexRequestQuestion[];
  content: (answers: Record<string, CodexRequestAnswer>) => Record<string, unknown>;
  canAccept: (answers: Record<string, CodexRequestAnswer>) => boolean;
} {
  const schema = asRecord(params.requestedSchema);
  const properties = asRecord(schema.properties);
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []
  );
  const questions = Object.entries(properties)
    .slice(0, 24)
    .flatMap(([id, raw]) => {
      const field = asRecord(raw);
      const type = text(field.type);
      const options = enumOptions(field);
      const question: CodexRequestQuestion = {
        id,
        label: text(field.title) ?? text(field.description) ?? id,
        secret: false,
        required: required.has(id),
        kind:
          type === "boolean"
            ? "boolean"
            : type === "number" || type === "integer"
              ? "number"
              : type === "array"
                ? "multiselect"
                : options.length
                  ? "select"
                  : "text",
        options,
        min: numeric(field.minimum) ?? numeric(type === "array" ? field.minItems : field.minLength) ?? undefined,
        max: numeric(field.maximum) ?? numeric(type === "array" ? field.maxItems : field.maxLength) ?? undefined,
        integer: type === "integer"
      };
      return type ? [question] : [];
    });
  const content = (answers: Record<string, CodexRequestAnswer>) => {
    const entries: Array<[string, unknown]> = [];
    for (const question of questions) {
      const answer = answers[question.id];
      if (question.kind === "boolean" && answer === undefined) {
        if (question.required) entries.push([question.id, false]);
        continue;
      }
      if (answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0)) {
        continue;
      }
      entries.push([question.id, question.kind === "number" ? Number(answer) : answer]);
    }
    return Object.fromEntries(entries);
  };
  const canAccept = (answers: Record<string, CodexRequestAnswer>) =>
    questions.every((question) => {
      const answer = answers[question.id];
      if (question.kind === "boolean") return answer === undefined || typeof answer === "boolean";
      if (
        !question.required &&
        (answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0))
      )
        return true;
      if (
        question.required &&
        (answer === undefined || answer === "" || (Array.isArray(answer) && answer.length === 0))
      )
        return false;
      if (question.kind === "multiselect") {
        return (
          Array.isArray(answer) &&
          (question.min === undefined || answer.length >= question.min) &&
          (question.max === undefined || answer.length <= question.max) &&
          answer.every((value) => question.options.some((option) => option.value === value))
        );
      }
      if (typeof answer !== "string") return false;
      if (question.kind === "number") {
        const number = Number(answer);
        return (
          Number.isFinite(number) &&
          (!question.integer || Number.isInteger(number)) &&
          (question.min === undefined || number >= question.min) &&
          (question.max === undefined || number <= question.max)
        );
      }
      return (
        (question.min === undefined || answer.length >= question.min) &&
        (question.max === undefined || answer.length <= question.max) &&
        (!question.options.length || question.options.some((option) => option.value === answer))
      );
    });
  return { questions, content, canAccept };
}

function enumOptions(field: Record<string, unknown>): Array<{ value: string; label: string }> {
  const source = field.enum ?? asRecord(field.items).enum;
  if (Array.isArray(source)) {
    return source.slice(0, 50).flatMap((value) => (typeof value === "string" ? [{ value, label: value }] : []));
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const values = field[key] ?? asRecord(field.items)[key];
    if (Array.isArray(values)) {
      return values.slice(0, 50).flatMap((value) => {
        const option = asRecord(value);
        const constant = text(option.const);
        return constant ? [{ value: constant, label: text(option.title) ?? constant }] : [];
      });
    }
  }
  return [];
}

function safeWebUrl(value: unknown): string | null {
  const url = text(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2_000) : null;
}

function formatCommand(command: unknown, cwd: unknown): string | null {
  const commandText = Array.isArray(command)
    ? command.filter((part): part is string => typeof part === "string").join(" ")
    : text(command);
  const cwdText = text(cwd);
  return [commandText, cwdText ? `in ${cwdText}` : null].filter(Boolean).join("\n").slice(0, 4_000) || null;
}
