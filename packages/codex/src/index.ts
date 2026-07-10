import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";

export interface CodexAppServerConfig {
  executablePath?: string;
  listen?: "stdio" | `ws://${string}` | `unix://${string}` | "off";
  model?: string;
  cwd?: string;
}

export type JsonRpcId = string | number;

export interface JsonRpcRequest<TParams = unknown> {
  method: string;
  id: JsonRpcId;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  method: string;
  params?: TParams;
}

export type JsonRpcMessage<TParams = unknown> =
  | JsonRpcRequest<TParams>
  | JsonRpcNotification<TParams>;

export interface JsonRpcResponse<TResult = unknown> {
  id: JsonRpcId;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcServerRequest<TParams = unknown> {
  method: string;
  id: JsonRpcId;
  params?: TParams;
}

export type JsonRpcInboundMessage =
  | { kind: "response"; message: JsonRpcResponse }
  | { kind: "notification"; message: JsonRpcNotification }
  | { kind: "serverRequest"; message: JsonRpcServerRequest };

export interface CodexThreadStartResult {
  thread?: {
    id: string;
  };
}

export interface CodexAppServerEvents {
  notification: [JsonRpcNotification];
  serverRequest: [JsonRpcServerRequest];
  orphanResponse: [JsonRpcResponse];
  protocolError: [Error];
  stderr: [string];
  exit: [{ code: number | null; signal: NodeJS.Signals | null }];
}

export function createInitializeRequest(id: JsonRpcId): JsonRpcRequest {
  return {
    method: "initialize",
    id,
    params: {
      clientInfo: {
        name: "multaiplayer",
        title: "multAIplayer",
        version: "0.1.0-alpha.0"
      },
      capabilities: {
        experimentalApi: true
      }
    }
  };
}

// Keep this dependency-free fallback aligned with @multaiplayer/protocol's defaultCodexModel.
const defaultCodexModel = "gpt-5.6-sol";

export function createThreadStartRequest(id: JsonRpcId, model = defaultCodexModel): JsonRpcRequest {
  return {
    method: "thread/start",
    id,
    params: { model }
  };
}

export function createTurnStartRequest(
  id: JsonRpcId,
  threadId: string,
  input: string,
  cwd?: string
): JsonRpcRequest {
  return {
    method: "turn/start",
    id,
    params: {
      threadId,
      input: [{ type: "text", text: input }],
      ...(cwd ? { cwd } : {})
    }
  };
}

export class CodexAppServerClient extends EventEmitter<CodexAppServerEvents> {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<
    JsonRpcId,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly config: CodexAppServerConfig = {}) {
    super();
  }

  start(): void {
    if (this.proc) return;

    const executable = this.config.executablePath ?? "codex";
    const listen = this.config.listen ?? "stdio";
    const args = ["app-server"];
    if (listen !== "stdio") {
      args.push("--listen", listen);
    }

    this.proc = spawn(executable, args, {
      cwd: this.config.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));
    this.proc.stderr.on("data", (chunk) => this.emit("stderr", chunk.toString()));
    this.proc.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });
      this.rejectAll(new Error(`codex app-server exited with ${code ?? signal ?? "unknown"}`));
      this.proc = null;
      this.rl = null;
    });
  }

  async initialize(): Promise<JsonRpcResponse> {
    const response = await this.request(createInitializeRequest(this.allocateId()));
    this.notify({ method: "initialized", params: {} });
    return response;
  }

  async startThread(model = this.config.model ?? defaultCodexModel): Promise<CodexThreadStartResult> {
    const response = await this.request<CodexThreadStartResult>(
      createThreadStartRequest(this.allocateId(), model)
    );
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result ?? {};
  }

  async startTurn(threadId: string, input: string, cwd = this.config.cwd): Promise<JsonRpcResponse> {
    return this.request(createTurnStartRequest(this.allocateId(), threadId, input, cwd));
  }

  request<TResult = unknown>(
    request: JsonRpcRequest,
    timeoutMs = 120_000
  ): Promise<JsonRpcResponse<TResult>> {
    this.ensureStarted();
    const id = request.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for app-server response to ${request.method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: JsonRpcResponse) => void, reject, timeout });
      this.write(request);
    });
  }

  notify(notification: JsonRpcNotification): void {
    this.ensureStarted();
    this.write(notification);
  }

  respond<TResult = unknown>(id: JsonRpcId, result: TResult): void {
    this.ensureStarted();
    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.ensureStarted();
    this.write({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  close(): void {
    this.rl?.close();
    this.proc?.kill();
    this.proc = null;
    this.rl = null;
    this.rejectAll(new Error("codex app-server client closed"));
  }

  private handleLine(line: string): void {
    let inbound: JsonRpcInboundMessage;
    try {
      inbound = classifyJsonRpcMessage(JSON.parse(line));
    } catch (error) {
      this.emit("protocolError", error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (inbound.kind === "response") {
      const pending = this.pending.get(inbound.message.id);
      if (!pending) {
        this.emit("orphanResponse", inbound.message);
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(inbound.message.id);
      pending.resolve(inbound.message);
      return;
    }
    if (inbound.kind === "serverRequest") {
      this.emit("serverRequest", inbound.message);
      return;
    }
    this.emit("notification", inbound.message);
  }

  private write(message: JsonRpcMessage | JsonRpcResponse): void {
    this.proc?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  private ensureStarted(): void {
    if (!this.proc) this.start();
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function classifyJsonRpcMessage(value: unknown): JsonRpcInboundMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App-server message must be a JSON object");
  }
  const message = value as Record<string, unknown>;
  const hasId = isJsonRpcId(message.id);
  const hasMethod = typeof message.method === "string" && message.method.length > 0;
  if (hasMethod && hasId) {
    return { kind: "serverRequest", message: message as unknown as JsonRpcServerRequest };
  }
  if (hasMethod && message.id === undefined) {
    return { kind: "notification", message: message as unknown as JsonRpcNotification };
  }
  const hasResult = Object.prototype.hasOwnProperty.call(message, "result");
  const hasError = Object.prototype.hasOwnProperty.call(message, "error");
  if (hasId && hasResult !== hasError) {
    return { kind: "response", message: message as unknown as JsonRpcResponse };
  }
  throw new Error("App-server message is not a valid response, notification, or server request");
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}
