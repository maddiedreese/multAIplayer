import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installGlobalDiagnostics } from "./lib/diagnostics";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

installGlobalDiagnostics();

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
