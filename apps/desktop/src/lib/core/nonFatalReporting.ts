type NonFatalReporter = (operation: string, error?: unknown) => void;

let reporter: NonFatalReporter | null = null;

export function configureNonFatalReporter(nextReporter: NonFatalReporter) {
  reporter = nextReporter;
}

/** Report a recoverable failure using only a stable operation name. */
export function reportNonFatal(operation: string, error?: unknown) {
  if (reporter) {
    reporter(operation, error);
    return;
  }
  if (!isTestRuntime()) console.warn(`Non-fatal failure: ${operation}`);
}

/** Document a normal fallback without logging rejected or attacker-controlled input. */
export function reportExpectedFailure(operation: string) {
  if (!isTestRuntime()) console.debug(`[expected failure] ${operation}`);
}

function isTestRuntime(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "test";
}
