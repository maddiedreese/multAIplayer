import { RelayHttpErrorCode, type RelayHttpErrorCodeType } from "@multaiplayer/protocol";
import { reportExpectedFailure } from "./nonFatalReporting";

export class RelayHttpError extends Error {
  override readonly name = "RelayHttpError";

  constructor(
    message: string,
    readonly status: number,
    readonly code: RelayHttpErrorCodeType | null,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
  }
}

export function isRelayHttpErrorCode(error: unknown, code: RelayHttpErrorCodeType): error is RelayHttpError {
  return error instanceof RelayHttpError && error.code === code;
}

export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await readOptionalJson(response);
  if (!response.ok) {
    const relayMessage =
      typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
    const parsedCode = RelayHttpErrorCode.safeParse(body?.code);
    throw new RelayHttpError(
      relayMessage ?? `${fallbackMessage}: HTTP ${response.status}`,
      response.status,
      parsedCode.success ? parsedCode.data : null,
      parseRetryAfterMs(response, body)
    );
  }
  return body as T;
}

function parseRetryAfterMs(response: Response, body: Record<string, unknown> | null): number | null {
  const bodySeconds = body?.retryAfterSeconds;
  const header = response.headers.get("retry-after");
  const headerSeconds = header === null ? null : Number(header);
  const seconds =
    typeof bodySeconds === "number" && Number.isFinite(bodySeconds) && bodySeconds >= 0
      ? bodySeconds
      : headerSeconds !== null && Number.isFinite(headerSeconds) && headerSeconds >= 0
        ? headerSeconds
        : null;
  return seconds === null ? null : Math.min(30_000, Math.ceil(seconds * 1_000));
}

async function readOptionalJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    reportExpectedFailure("HTTP response did not contain a JSON object");
    return null;
  }
}
