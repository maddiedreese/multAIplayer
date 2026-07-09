import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktopPort = Number.parseInt(process.env.VITE_DESKTOP_PORT ?? "1420", 10);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "patched-monaco-dompurify",
      enforce: "pre",
      async resolveId(source, importer) {
        if (
          source !== "./dompurify/dompurify.js" ||
          !importer?.includes("/monaco-editor/esm/vs/base/browser/domSanitize.js")
        ) {
          return null;
        }
        return this.resolve("dompurify", importer, { skipSelf: true });
      }
    }
  ],
  clearScreen: false,
  server: {
    port: Number.isFinite(desktopPort) ? desktopPort : 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: false
  }
});
