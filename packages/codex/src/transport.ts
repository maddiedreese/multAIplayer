import type { JsonRpcMessage, JsonRpcResponse } from "./json-rpc.js";

export interface CodexAppServerConfig {
  executablePath?: string;
  listen?: "stdio" | `ws://${string}` | `unix://${string}` | "off";
  model?: string;
  cwd?: string;
}

export interface CodexTransportHandlers {
  message(line: string): void;
  stderr(text: string): void;
  exit(code: number | null, signal: NodeJS.Signals | null): void;
}

export interface CodexAppServerTransport {
  start(handlers: CodexTransportHandlers): void;
  send(message: JsonRpcMessage | JsonRpcResponse): void;
  close(): void;
}

export type CodexTransportFactory = (config: Readonly<CodexAppServerConfig>) => CodexAppServerTransport;

export interface CodexScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CodexAppServerClientDependencies {
  createTransport?: CodexTransportFactory;
  scheduler?: CodexScheduler;
}
