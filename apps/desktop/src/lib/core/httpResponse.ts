import { RelayHttpErrorCode, type RelayHttpErrorCodeType } from "@multaiplayer/protocol";
import { reportExpectedFailure } from "./nonFatalReporting";

export class RelayHttpError extends Error {
  override readonly name = "RelayHttpError";

  constructor(
    message: string,
    readonly status: number,
    readonly code: RelayHttpErrorCodeType | null
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
      parsedCode.success ? parsedCode.data : null
    );
  }
  return body as T;
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
