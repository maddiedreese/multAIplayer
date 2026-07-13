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
  console.warn(`Non-fatal failure: ${operation}`);
}

/** Document a normal fallback without logging rejected or attacker-controlled input. */
export function reportExpectedFailure(operation: string) {
  console.debug(`[expected failure] ${operation}`);
}
