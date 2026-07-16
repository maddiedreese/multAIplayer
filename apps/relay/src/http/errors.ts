import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { logRelayEvent } from "../observability.js";
import { RelayStoreByteCapacityError, RelayStoreCapacityError } from "../state.js";
import {
  RelayHttpErrorCode,
  type RelayHttpErrorCodeType,
  type RelayHttpErrorResponseType
} from "@multaiplayer/protocol";

export function sendRelayError(
  response: Response,
  status: number,
  code: RelayHttpErrorCodeType,
  error: string,
  details: Record<string, unknown> = {}
) {
  const body: RelayHttpErrorResponseType = { error, code, ...details };
  response.status(status).json(body);
}

export function sendRelayCapacityError(
  response: Response,
  error: RelayStoreCapacityError | RelayStoreByteCapacityError
) {
  const capacity =
    error instanceof RelayStoreByteCapacityError
      ? { resource: error.resource, scope: error.scope, limit: error.maximumBytes }
      : { resource: "durable_entries", scope: error.teamId ? "team" : "relay", limit: error.maxDurableEntries };
  sendRelayError(response, 507, "capacity_exceeded", "Relay durable capacity is exhausted.", { capacity });
}

/**
 * Compatibility boundary for handlers that predate the typed error contract.
 * It preserves their human-readable fields while ensuring clients can always
 * branch on a stable code. New handlers should call sendRelayError directly.
 */
export function typedRelayErrorMiddleware(_request: Request, response: Response, next: NextFunction) {
  const sendJson = response.json.bind(response);
  response.json = ((body: unknown) => {
    if (response.statusCode >= 400 && isErrorBody(body)) {
      const candidate = body.code;
      if (!RelayHttpErrorCode.safeParse(candidate).success) {
        return sendJson({ ...body, code: defaultRelayHttpErrorCode(response.statusCode, body.error) });
      }
    }
    return sendJson(body);
  }) as Response["json"];
  next();
}

export const relayJsonBodyErrorMiddleware: ErrorRequestHandler = (error, _request, response, next) => {
  const bodyError = error as { status?: unknown; type?: unknown };
  if (bodyError.status === 413 || bodyError.type === "entity.too.large") {
    sendRelayError(response, 413, "payload_too_large", "JSON request body exceeds the relay limit.");
    return;
  }
  if (bodyError.status === 400 && bodyError.type === "entity.parse.failed") {
    sendRelayError(response, 400, "invalid_request", "JSON request body is malformed.");
    return;
  }
  next(error);
};

export function createContentLengthGuard(maxBytes: number): RequestHandler {
  return (request, response, next) => {
    if (request.body !== undefined) return next();
    const header = request.headers["content-length"];
    const value = Array.isArray(header) ? header[0] : header;
    const length = value === undefined ? null : Number(value);
    if (length !== null && (!Number.isSafeInteger(length) || length < 0)) {
      sendRelayError(response, 400, "invalid_request", "Content-Length must be a non-negative integer.");
      return;
    }
    if (length !== null && length > maxBytes) {
      sendRelayError(response, 413, "payload_too_large", "JSON request body exceeds the relay limit.");
      return;
    }
    next();
  };
}

export const relayNotFoundMiddleware: RequestHandler = (_request, response) => {
  sendRelayError(response, 404, "not_found", "Route not found.");
};

export const relayInternalErrorMiddleware: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error instanceof RelayStoreCapacityError || error instanceof RelayStoreByteCapacityError) {
    sendRelayCapacityError(response, error);
    return;
  }
  logRelayEvent("error", "http_request_failed", {
    method: request.method,
    path: request.path.slice(0, 160)
  });
  sendRelayError(response, 500, "internal_error", "The relay could not complete this request.");
};

function isErrorBody(body: unknown): body is Record<string, unknown> & { error: string } {
  return typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).error === "string";
}

export function defaultRelayHttpErrorCode(status: number, message = ""): RelayHttpErrorCodeType {
  const normalized = message.toLowerCase();
  const contextual = contextualErrorCode(status, normalized);
  return contextual ?? statusErrorCode(status);
}

function contextualErrorCode(status: number, message: string): RelayHttpErrorCodeType | null {
  const mappings: ReadonlyArray<readonly [number, string, RelayHttpErrorCodeType]> = [
    [403, "device-authenticated", "device_auth_required"],
    [404, "team member", "team_member_not_found"],
    [404, "team", "team_not_found"],
    [404, "room", "room_not_found"],
    [404, "invite", "invite_not_found"],
    [410, "invite", "invite_expired"],
    [503, "persist", "persistence_unavailable"]
  ];
  return mappings.find(([candidate, text]) => candidate === status && message.includes(text))?.[2] ?? null;
}

function statusErrorCode(status: number): RelayHttpErrorCodeType {
  const codes: Partial<Record<number, RelayHttpErrorCodeType>> = {
    400: "invalid_request",
    401: "authentication_required",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    410: "invite_expired",
    413: "payload_too_large",
    422: "invalid_request",
    429: "rate_limited",
    502: "upstream_unavailable",
    503: "persistence_unavailable",
    504: "upstream_unavailable",
    507: "capacity_exceeded"
  };
  return codes[status] ?? "internal_error";
}
