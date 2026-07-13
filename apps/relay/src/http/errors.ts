import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
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

function isErrorBody(body: unknown): body is Record<string, unknown> & { error: string } {
  return typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).error === "string";
}

export function defaultRelayHttpErrorCode(status: number, message = ""): RelayHttpErrorCodeType {
  const normalized = message.toLowerCase();
  if (status === 403 && normalized.includes("device-authenticated")) return "device_auth_required";
  if (status === 404 && normalized.includes("team member")) return "team_member_not_found";
  if (status === 404 && normalized.includes("team")) return "team_not_found";
  if (status === 404 && normalized.includes("room")) return "room_not_found";
  if (status === 404 && normalized.includes("invite")) return "invite_not_found";
  if (status === 410 && normalized.includes("invite")) return "invite_expired";
  if (status === 503 && normalized.includes("persist")) return "persistence_unavailable";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401) return "authentication_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "invite_expired";
  if (status === 413) return "payload_too_large";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 504) return "upstream_unavailable";
  if (status === 503) return "persistence_unavailable";
  return "internal_error";
}
