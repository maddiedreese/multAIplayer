import { EventEmitter } from "node:events";
import {
  classifyJsonRpcMessage,
  createInitializeRequest,
  createThreadStartRequest,
  createTurnStartRequest,
  defaultCodexModel,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcServerRequest
} from "./json-rpc.js";
import { createStdioCodexTransport } from "./stdio-transport.js";
import type {
  CodexAppServerClientDependencies,
  CodexAppServerConfig,
  CodexAppServerTransport,
  CodexScheduler
} from "./transport.js";

export interface CodexThreadStartResult {
  thread?: { id: string };
}

export interface CodexAppServerEvents {
  notification: [JsonRpcNotification];
  serverRequest: [JsonRpcServerRequest];
  orphanResponse: [JsonRpcResponse];
  protocolError: [Error];
  stderr: [string];
  exit: [{ code: number | null; signal: NodeJS.Signals | null }];
}

const systemScheduler: CodexScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export class CodexAppServerClient extends EventEmitter<CodexAppServerEvents> {
  private transport: CodexAppServerTransport | null = null;
  private nextId = 1;
  private readonly createTransport;
  private readonly scheduler;
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void; timeout: unknown }
  >();

  constructor(
    private readonly config: CodexAppServerConfig = {},
    dependencies: CodexAppServerClientDependencies = {}
  ) {
    super();
    this.createTransport = dependencies.createTransport ?? createStdioCodexTransport;
    this.scheduler = dependencies.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.transport) return;
    const transport = this.createTransport(this.config);
    this.transport = transport;
    transport.start({
      message: (line) => this.handleLine(line),
      stderr: (text) => this.emit("stderr", text),
      exit: (code, signal) => this.handleExit(transport, code, signal)
    });
  }

  async initialize(): Promise<JsonRpcResponse> {
    const response = await this.request(createInitializeRequest(this.allocateId()));
    this.notify({ method: "initialized", params: {} });
    return response;
  }

  async startThread(model = this.config.model ?? defaultCodexModel): Promise<CodexThreadStartResult> {
    const response = await this.request<CodexThreadStartResult>(createThreadStartRequest(this.allocateId(), model));
    if (response.error) throw new Error(response.error.message);
    return response.result ?? {};
  }

  startTurn(threadId: string, input: string, cwd = this.config.cwd): Promise<JsonRpcResponse> {
    return this.request(createTurnStartRequest(this.allocateId(), threadId, input, cwd));
  }

  request<TResult = unknown>(request: JsonRpcRequest, timeoutMs = 120_000): Promise<JsonRpcResponse<TResult>> {
    this.ensureStarted();
    if (this.pending.has(request.id)) return Promise.reject(new Error(`Duplicate JSON-RPC request id: ${request.id}`));
    return new Promise((resolve, reject) => {
      const timeout = this.scheduler.setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Timed out waiting for app-server response to ${request.method}`));
      }, timeoutMs);
      this.pending.set(request.id, { resolve: resolve as (value: JsonRpcResponse) => void, reject, timeout });
      try {
        this.transport!.send(request);
      } catch (error) {
        this.pending.delete(request.id);
        this.scheduler.clearTimeout(timeout);
        reject(error);
      }
    });
  }

  notify(notification: JsonRpcNotification): void {
    this.send(notification);
  }
  respond<TResult = unknown>(id: JsonRpcId, result: TResult): void {
    this.send({ id, result });
  }
  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.send({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  close(): void {
    const transport = this.transport;
    this.transport = null;
    transport?.close();
    this.rejectAll(new Error("codex app-server client closed"));
  }

  private send(message: JsonRpcNotification | JsonRpcResponse): void {
    this.ensureStarted();
    this.transport!.send(message);
  }

  private handleLine(line: string): void {
    try {
      const inbound = classifyJsonRpcMessage(JSON.parse(line));
      if (inbound.kind === "response") {
        const pending = this.pending.get(inbound.message.id);
        if (!pending) return void this.emit("orphanResponse", inbound.message);
        this.pending.delete(inbound.message.id);
        this.scheduler.clearTimeout(pending.timeout);
        pending.resolve(inbound.message);
      } else if (inbound.kind === "serverRequest") this.emit("serverRequest", inbound.message);
      else this.emit("notification", inbound.message);
    } catch (error) {
      this.emit("protocolError", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleExit(transport: CodexAppServerTransport, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.transport !== transport) return;
    this.transport = null;
    this.emit("exit", { code, signal });
    this.rejectAll(new Error(`codex app-server exited with ${code ?? signal ?? "unknown"}`));
  }

  private allocateId(): number {
    return this.nextId++;
  }
  private ensureStarted(): void {
    if (!this.transport) this.start();
  }
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.scheduler.clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
