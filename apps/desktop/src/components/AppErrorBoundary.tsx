import React from "react";
import { recordDiagnosticEvent } from "../lib/platform/diagnostics";
import { BUG_REPORT_URL } from "../lib/core/productLinks";

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    recordDiagnosticEvent("error", "React render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="native-required" data-testid="app-recovery-surface">
        <section>
          <p className="native-required-eyebrow">Interface recovery</p>
          <h1>The interface stopped unexpectedly.</h1>
          <p>
            Your room data was not cleared. Reload the interface, then optionally save metadata-only diagnostics from
            Profile and report the bug. Nothing is uploaded automatically, and diagnostic exports never include room
            content.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload interface
          </button>
          <p>
            <a href={BUG_REPORT_URL} target="_blank" rel="noreferrer noopener">
              Report this bug
            </a>
          </p>
        </section>
      </main>
    );
  }
}
