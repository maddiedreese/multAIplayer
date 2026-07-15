import { useEffect, useRef } from "react";
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

    void loadMonaco().then((monaco) => {
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
    });

    return () => {
      cancelled = true;
      disposable?.dispose();
      editorRef.current?.dispose();
      modelRef.current?.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [loadMonaco, path]);

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

  return <div className="monaco-file-editor" ref={containerRef} aria-label={`Edit ${path}`} />;
}

async function installMonaco(): Promise<typeof Monaco> {
  const [
    monaco,
    { default: EditorWorker },
    { default: JsonWorker },
    { default: CssWorker },
    { default: HtmlWorker },
    { default: TsWorker }
  ] = await Promise.all([
    import("monaco-editor"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    import("monaco-editor/esm/vs/language/json/json.worker?worker"),
    import("monaco-editor/esm/vs/language/css/css.worker?worker"),
    import("monaco-editor/esm/vs/language/html/html.worker?worker"),
    import("monaco-editor/esm/vs/language/typescript/ts.worker?worker")
  ]);

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    }
  };

  return monaco;
}

export function languageForPath(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "cts":
    case "mts":
    case "ts":
    case "tsx":
      return "typescript";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "rs":
      return "rust";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return undefined;
  }
}
