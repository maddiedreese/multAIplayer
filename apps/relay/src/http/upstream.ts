const defaultUpstreamTimeoutMs = 10_000;

/** Fetch an upstream dependency without allowing it to occupy a relay handler indefinitely. */
export async function fetchUpstream(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = defaultUpstreamTimeoutMs
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch {
    const timedOut = timeoutSignal.aborted;
    return Response.json(
      { error: timedOut ? "Upstream request timed out." : "Upstream request failed." },
      { status: timedOut ? 504 : 502 }
    );
  }
}
