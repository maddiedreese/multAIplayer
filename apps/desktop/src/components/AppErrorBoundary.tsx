import React from "react";
import { recordDiagnosticEvent } from "../lib/platform/diagnostics";

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
            Your room data was not cleared. Reload the interface, then export diagnostics from Profile if this happens
            again.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload interface
          </button>
        </section>
      </main>
    );
  }
}
