import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installGlobalDiagnostics } from "./lib/diagnostics";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

async function bootstrap() {
  if (import.meta.env.VITE_NATIVE_E2E === "true") {
    await import("@wdio/tauri-plugin");
  }

  installGlobalDiagnostics();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
