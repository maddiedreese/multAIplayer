import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: process.cwd(),
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1422,
    strictPort: true
  },
  envPrefix: ["VITE_"],
  build: {
    target: "es2022",
    outDir: resolve(process.cwd(), ".multaiplayer/e2e-harness-build"),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(process.cwd(), "e2e/harness/index.html")
    }
  }
});
