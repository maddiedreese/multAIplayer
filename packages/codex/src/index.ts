import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";

export interface CodexAppServerConfig {
  executablePath?: string;
  listen?: "stdio" | `ws://${string}` | `unix://${string}` | "off";
  model?: string;
  cwd?: string;
}

export interface JsonRpcRequest<TParams = unknown> {
  method: string;
  id: number;
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
  id: number;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface CodexThreadStartResult {
  thread?: {
    id: string;
  };
}

export interface CodexAppServerEvents {
  notification: [JsonRpcNotification];
  stderr: [string];
  exit: [{ code: number | null; signal: NodeJS.Signals | null }];
}

export function createInitializeRequest(id: number): JsonRpcRequest {
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

export function createThreadStartRequest(id: number, model = "gpt-5.5"): JsonRpcRequest {
  return {
    method: "thread/start",
    id,
    params: { model }
  };
}

export function createTurnStartRequest(
  id: number,
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
    number,
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

  async startThread(model = this.config.model ?? "gpt-5.5"): Promise<CodexThreadStartResult> {
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

  close(): void {
    this.rl?.close();
    this.proc?.kill();
    this.proc = null;
    this.rl = null;
    this.rejectAll(new Error("codex app-server client closed"));
  }

  private handleLine(line: string): void {
    const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      pending.resolve(message);
      return;
    }
    this.emit("notification", message);
  }

  private write(message: JsonRpcMessage): void {
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
