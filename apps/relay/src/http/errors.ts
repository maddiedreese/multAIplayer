import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { logRelayEvent } from "../observability.js";
import { RelayStoreByteCapacityError, RelayStoreCapacityError } from "../state.js";
import type { RelayHttpErrorCodeType, RelayHttpErrorResponseType } from "@multaiplayer/protocol";

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
