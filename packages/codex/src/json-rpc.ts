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

export type JsonRpcMessage<TParams = unknown> = JsonRpcRequest<TParams> | JsonRpcNotification<TParams>;

export interface JsonRpcResponse<TResult = unknown> {
  id: JsonRpcId;
  result?: TResult;
  error?: { code: number; message: string; data?: unknown };
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

export function createInitializeRequest(id: JsonRpcId): JsonRpcRequest {
  return {
    method: "initialize",
    id,
    params: {
      clientInfo: { name: "multaiplayer", title: "multAIplayer", version: "0.1.0-alpha.0" }, // x-release-please-version
      capabilities: { experimentalApi: true }
    }
  };
}

export const defaultCodexModel = "gpt-5.6-sol";

export function createThreadStartRequest(id: JsonRpcId, model = defaultCodexModel): JsonRpcRequest {
  return { method: "thread/start", id, params: { model } };
}

export function createTurnStartRequest(id: JsonRpcId, threadId: string, input: string, cwd?: string): JsonRpcRequest {
  return {
    method: "turn/start",
    id,
    params: { threadId, input: [{ type: "text", text: input }], ...(cwd ? { cwd } : {}) }
  };
}

export function classifyJsonRpcMessage(value: unknown): JsonRpcInboundMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App-server message must be a JSON object");
  }
  const message = value as Record<string, unknown>;
  const hasId = isJsonRpcId(message.id);
  const hasMethod = typeof message.method === "string" && message.method.length > 0;
  if (hasMethod && hasId) return { kind: "serverRequest", message: message as unknown as JsonRpcServerRequest };
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
