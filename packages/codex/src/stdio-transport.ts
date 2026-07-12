import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { JsonRpcMessage, JsonRpcResponse } from "./json-rpc.js";
import type { CodexAppServerConfig, CodexAppServerTransport, CodexTransportHandlers } from "./transport.js";

export type SpawnCodexProcess = typeof spawn;

export class StdioCodexAppServerTransport implements CodexAppServerTransport {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;

  constructor(
    private readonly config: Readonly<CodexAppServerConfig>,
    private readonly spawnProcess: SpawnCodexProcess = spawn
  ) {}

  start(handlers: CodexTransportHandlers): void {
    if (this.process) return;
    const listen = this.config.listen ?? "stdio";
    const args = ["app-server"];
    if (listen !== "stdio") args.push("--listen", listen);
    const process = this.spawnProcess(this.config.executablePath ?? "codex", args, {
      cwd: this.config.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process = process;
    this.lines = createInterface({ input: process.stdout });
    this.lines.on("line", handlers.message);
    process.stderr.on("data", (chunk) => handlers.stderr(chunk.toString()));
    process.on("exit", handlers.exit);
  }

  send(message: JsonRpcMessage | JsonRpcResponse): void {
    if (!this.process) throw new Error("codex app-server transport is not started");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    if (!this.process) return;
    this.lines?.close();
    this.process.kill();
    this.process = null;
    this.lines = null;
  }
}

export const createStdioCodexTransport = (config: Readonly<CodexAppServerConfig>): CodexAppServerTransport =>
  new StdioCodexAppServerTransport(config);
