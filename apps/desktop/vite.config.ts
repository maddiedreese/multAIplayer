import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { patchedMonacoDompurify } from "../../tools/vite/patched-monaco-dompurify";

const desktopPort = Number.parseInt(process.env.VITE_DESKTOP_PORT ?? "1420", 10);

export default defineConfig({
  plugins: [react(), patchedMonacoDompurify()],
  envDir: "../..",
  clearScreen: false,
  server: {
    port: Number.isFinite(desktopPort) ? desktopPort : 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild"
  }
});
