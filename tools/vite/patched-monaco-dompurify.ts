import type { Plugin } from "vite";

/**
 * Keep Monaco's sanitizer on the repository's patched DOMPurify version.
 * Both the shipped desktop build and its production-browser contract harness
 * use this resolver so the harness cannot exercise a different bundle path.
 */
export function patchedMonacoDompurify(): Plugin {
  return {
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
  };
}
