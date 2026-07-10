export async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await readOptionalJson(response);
  if (!response.ok) {
    const relayMessage =
      typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : null;
    throw new Error(relayMessage ?? `${fallbackMessage}: HTTP ${response.status}`);
  }
  return body as T;
}

async function readOptionalJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
