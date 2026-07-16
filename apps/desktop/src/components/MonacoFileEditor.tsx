import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";

export function MonacoFileEditor({
  path,
  value,
  disabled,
  onChange,
  loadMonaco = installMonaco
}: {
  path: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  loadMonaco?: () => Promise<typeof Monaco>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  valueRef.current = value;
  disabledRef.current = disabled;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let disposable: Monaco.IDisposable | null = null;
    setLoadError(false);

    void loadMonaco()
      .then((monaco) => {
        if (cancelled || !containerRef.current) return;
        const uri = monaco.Uri.parse(`file:///${path.replace(/^\/+/, "")}`);
        const model = monaco.editor.createModel(valueRef.current, languageForPath(path), uri);
        modelRef.current = model;
        const editor = monaco.editor.create(containerRef.current, {
          model,
          readOnly: disabledRef.current,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: "selection",
          fixedOverflowWidgets: true
        });
        editorRef.current = editor;
        disposable = editor.onDidChangeModelContent(() => {
          onChangeRef.current(editor.getValue());
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      disposable?.dispose();
      editorRef.current?.dispose();
      modelRef.current?.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [loadAttempt, loadMonaco, path]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === value) return;
    editor.executeEdits("external-update", [
      {
        range: model.getFullModelRange(),
        text: value
      }
    ]);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: disabled });
  }, [disabled]);

  return (
    <div className="monaco-file-editor-shell">
      <div className="monaco-file-editor" ref={containerRef} aria-label={`Edit ${path}`} />
      {loadError && (
        <div className="workflow-message" role="alert">
          The code editor could not be loaded.
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry editor
          </button>
        </div>
      )}
    </div>
  );
}

async function installMonaco(): Promise<typeof Monaco> {
  const [monaco, { default: EditorWorker }, { default: JsonWorker }] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api.js"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/base/browser/domSanitize.js"),
    import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js"),
    import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js")
  ]);

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new JsonWorker();
      return new EditorWorker();
    }
  };

  return monaco as unknown as typeof Monaco;
}

export function languageForPath(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? languageByExtension[extension] : undefined;
}

const languageByExtension: Readonly<Record<string, string>> = {
  cjs: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cts: "typescript",
  mts: "typescript",
  ts: "typescript",
  tsx: "typescript",
  css: "css",
  html: "html",
  htm: "html",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  rs: "rust",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml"
};
