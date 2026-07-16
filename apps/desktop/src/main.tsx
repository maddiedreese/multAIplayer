import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installGlobalDiagnostics } from "./lib/platform/diagnostics";
import { isTauriRuntime } from "./lib/platform/localBackend/runtime";
import "@xterm/xterm/css/xterm.css";
import "./styles/index.css";

async function bootstrap() {
  if (import.meta.env.VITE_NATIVE_E2E === "true") {
    await import("@wdio/tauri-plugin");
  }

  if (isTauriRuntime()) installGlobalDiagnostics();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
