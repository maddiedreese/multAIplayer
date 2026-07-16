import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:5173/" });
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Event: dom.window.Event,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

const React = (await import("react")).default;
Object.defineProperty(globalThis, "React", { configurable: true, value: React });
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { BrowserAccessPanel } = await import("../src/components/BrowserAccessPanel");
const { CodexAccountPanelView } = await import("../src/components/CodexAccountPanel");
const { languageForPath, MonacoFileEditor } = await import("../src/components/MonacoFileEditor");
const { WorkspaceFilesPanel } = await import("../src/components/WorkspaceFilesPanel");
type CodexAccountController = import("../src/hooks/useCodexAccount").CodexAccountController;
type WorkspaceFilesPanelProps = import("../src/components/workspaceFilesPanelTypes").WorkspaceFilesPanelProps;

afterEach(() => cleanup());

test("room browser exposes host controls, tab selection, and safe fallback iframe", () => {
  const events: string[] = [];
  const view = render(
    <BrowserAccessPanel
      hidden={false}
      activeBrowserUrl="https://preview.example/"
      browserRequests={[]}
      browserMessage={null}
      browserTabs={[
        {
          id: "preview",
          url: "https://preview.example/",
          title: "Preview",
          openedAt: "2026-07-14T00:00:00.000Z"
        },
        { id: "docs", url: "https://docs.example/", title: "Docs", openedAt: "2026-07-14T00:00:01.000Z" }
      ]}
      activeBrowserTabId="preview"
      browserUrl="https://preview.example/"
      canHostBrowser
      onBrowserUrlChange={(url) => events.push(`url:${url}`)}
      onOpenBrowserNow={() => events.push("open")}
      onApproveBrowserRequest={(request) => events.push(`approve:${request.id}`)}
      onDenyBrowserRequest={(requestId) => events.push(`deny:${requestId}`)}
      onOpenApprovedBrowserRequest={(request) => events.push(`approved-open:${request.id}`)}
      onSelectBrowserTab={(id) => events.push(`select:${id}`)}
      onCloseBrowserTab={(id) => events.push(`close:${id}`)}
    />
  );

  assert.equal(
    view.getByTitle("Room browser").getAttribute("sandbox"),
    "allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
  );
  fireEvent.click(view.getByRole("tab", { name: "Docs" }));
  fireEvent.click(view.getByRole("button", { name: "Close Docs" }));
  fireEvent.click(view.getByRole("button", { name: "Open URL" }));
  fireEvent.click(view.getByRole("button", { name: "Expand browser" }));

  assert.deepEqual(events, ["select:docs", "url:https://docs.example/", "close:docs", "open"]);
  assert.ok(view.getByRole("button", { name: "Return browser to column" }));
});

test("room browser exposes pending request provenance and explicit host approval actions", () => {
  const events: string[] = [];
  const pending = {
    id: "pending-browser",
    requester: "Teammate",
    requesterUserId: "github:teammate",
    url: "https://review.example/path?source=room",
    reason: "Requested by Teammate through Codex.",
    requestedAt: "2026-07-16T00:00:00.000Z",
    status: "pending" as const
  };
  const approved = {
    ...pending,
    id: "approved-browser",
    url: "https://approved.example/",
    status: "approved" as const
  };
  const view = render(
    <BrowserAccessPanel
      hidden={false}
      activeBrowserUrl={null}
      browserTabs={[]}
      browserRequests={[approved, pending]}
      browserMessage="Teammate requested browser access."
      activeBrowserTabId={null}
      browserUrl="https://default.example/"
      canHostBrowser
      onBrowserUrlChange={() => undefined}
      onOpenBrowserNow={() => undefined}
      onApproveBrowserRequest={(request) => events.push(`approve:${request.id}`)}
      onDenyBrowserRequest={(requestId) => events.push(`deny:${requestId}`)}
      onOpenApprovedBrowserRequest={(request) => events.push(`open:${request.id}`)}
      onSelectBrowserTab={() => undefined}
      onCloseBrowserTab={() => undefined}
    />
  );

  assert.ok(view.getByText(pending.url));
  assert.equal(view.getAllByText(pending.reason).length, 2);
  assert.ok(view.getAllByText(/Requested by Teammate/).length >= 1);
  fireEvent.click(view.getByRole("button", { name: /Approve browser access to https:\/\/review\.example/ }));
  fireEvent.click(view.getByRole("button", { name: /Deny browser access to https:\/\/review\.example/ }));
  fireEvent.click(view.getByRole("button", { name: /Open approved browser page at https:\/\/approved\.example/ }));
  assert.deepEqual(events, ["approve:pending-browser", "deny:pending-browser", "open:approved-browser"]);
});

test("Codex account view renders native capabilities and dispatches account actions", () => {
  const events: string[] = [];
  const resolved = async (event: string) => {
    events.push(event);
  };
  const controller = {
    native: true,
    snapshot: {
      capabilities: {
        codexVersion: "0.144.0",
        manifestVersion: "0.144.0",
        supportsAccount: true,
        supportsBrowserLogin: true,
        supportsDeviceLogin: true,
        supportsHostedLoginSuccess: true,
        supportsApps: true,
        supportsMcp: true,
        supportsWritesApproval: true,
        compatibilityWarning: null
      },
      requiresOpenaiAuth: true,
      account: null,
      apps: [{ id: "drive", name: "Drive", enabled: true, accessible: false }],
      appsError: null,
      mcpServers: [{ name: "docs", authStatus: "notLoggedIn", toolCount: 3 }],
      mcpError: null
    },
    login: null,
    loginBrowserOpenFailed: false,
    mcpLogin: null,
    busy: false,
    message: null,
    approvalMode: "prompt" as const,
    readiness: { status: "sign_in_required" as const, ready: false, message: "Sign in" },
    refresh: () => resolved("refresh"),
    beginLogin: (flow: "browser" | "device") => resolved(`login:${flow}`),
    cancelLogin: () => resolved("cancel"),
    signOut: () => resolved("signout"),
    connectMcp: (name: string) => resolved(`mcp:${name}`),
    updateApprovalMode: (mode: "auto" | "prompt" | "writes") => resolved(`approval:${mode}`)
  } satisfies CodexAccountController;
  const view = render(<CodexAccountPanelView controller={controller} />);

  fireEvent.click(view.getByRole("button", { name: "Refresh Codex account" }));
  fireEvent.click(view.getByRole("button", { name: "Sign in with ChatGPT" }));
  fireEvent.click(view.getByRole("button", { name: "Connect" }));
  fireEvent.change(view.getByRole("combobox"), { target: { value: "writes" } });

  assert.deepEqual(events, ["refresh", "login:browser", "mcp:docs", "approval:writes"]);
  assert.match(view.getByText("Drive").parentElement?.textContent ?? "", /Sign-in needed/);
});

test("Monaco language selection covers the app's documented editing formats", () => {
  assert.equal(languageForPath("src/App.TSX"), "typescript");
  assert.equal(languageForPath("Cargo.toml"), undefined);
  assert.equal(languageForPath("workflow.yaml"), "yaml");
  assert.equal(languageForPath("README.mdx"), "markdown");
  assert.equal(languageForPath("LICENSE"), undefined);
});

test("workspace files switch between project lists and a diff-only viewer without losing actions", () => {
  const events: string[] = [];
  const props = {
    fileQuery: "",
    projectFiles: [{ path: "src/app.ts", size: 42 }],
    selectedFile: null,
    gitStatus: {
      branch: "feature/files",
      files: [{ path: "src/app.ts", status: "modified", added: 2, removed: 1 }]
    },
    selectedDiff: null,
    fileBusy: false,
    fileMessage: null,
    fileSaveRequests: [],
    canReadLocalWorkspace: true,
    isActiveHost: true,
    canAttachSelectedFile: true,
    selectedFileRisks: [],
    selectedFileNeedsAttachmentReview: false,
    selectedSensitiveFileReviewed: false,
    selectedAttachmentActionLabel: "Attach",
    filePreviewTab: "file",
    formatBytes: (bytes) => `${bytes} B`,
    onCopyProjectMarkdown: () => events.push("copy-project"),
    onFileQueryChange: (query) => events.push(`query:${query}`),
    onOpenProjectFile: (path, tab) => events.push(`open:${tab}:${path}`),
    onCopyDiffSummaryMarkdown: () => events.push("copy-diff"),
    onAttachSelectedFileToMessage: () => events.push("attach"),
    onSaveSelectedFileContent: () => events.push("save"),
    onApproveFileSaveRequest: () => events.push("approve-save"),
    onDenyFileSaveRequest: () => events.push("deny-save"),
    onFilePreviewTabChange: (tab) => events.push(`tab:${tab}`),
    onCloseFileViewer: () => events.push("close")
  } satisfies WorkspaceFilesPanelProps;
  const view = render(<WorkspaceFilesPanel {...props} />);

  fireEvent.change(view.getByPlaceholderText("Search project files"), { target: { value: "app" } });
  fireEvent.click(view.getByRole("button", { name: /src\/app\.ts42 B/ }));
  fireEvent.click(view.getByRole("button", { name: /Summary/ }));
  assert.deepEqual(events, ["query:app", "open:file:src/app.ts", "copy-diff"]);

  view.rerender(
    <WorkspaceFilesPanel
      {...props}
      selectedDiff={{ path: "src/app.ts", diff: "@@ -1 +1 @@\n-old\n+new" }}
      filePreviewTab="diff"
    />
  );
  assert.ok(view.getByLabelText("Diff for src/app.ts"));
  fireEvent.click(view.getByRole("button", { name: "Close file editor" }));
  assert.equal(events.at(-1), "close");
});

test("Monaco editor synchronizes external values, read-only state, edits, and disposal", async () => {
  let modelValue = "const first = 1;";
  let changeListener = () => undefined;
  let editorDisposed = 0;
  let modelDisposed = 0;
  const optionUpdates: boolean[] = [];
  const changes: string[] = [];
  const model = {
    getValue: () => modelValue,
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
    dispose: () => {
      modelDisposed += 1;
    }
  };
  const editor = {
    getValue: () => modelValue,
    onDidChangeModelContent: (listener: () => void) => {
      changeListener = listener;
      return { dispose: () => undefined };
    },
    executeEdits: (_source: string, edits: Array<{ text: string }>) => {
      modelValue = edits[0]?.text ?? modelValue;
    },
    updateOptions: ({ readOnly }: { readOnly: boolean }) => optionUpdates.push(readOnly),
    dispose: () => {
      editorDisposed += 1;
    }
  };
  const monaco = {
    Uri: { parse: (value: string) => value },
    editor: {
      createModel: () => model,
      create: () => editor
    }
  };
  const loadMonaco = async () => monaco as never;
  const view = render(
    <MonacoFileEditor
      path="/src/app.ts"
      value={modelValue}
      disabled={false}
      onChange={(value) => changes.push(value)}
      loadMonaco={loadMonaco}
    />
  );

  await waitFor(() => assert.equal(view.getByLabelText("Edit /src/app.ts").className, "monaco-file-editor"));
  modelValue = "const edited = 2;";
  changeListener();
  assert.deepEqual(changes, ["const edited = 2;"]);

  view.rerender(
    <MonacoFileEditor
      path="/src/app.ts"
      value="const external = 3;"
      disabled
      onChange={(value) => changes.push(value)}
      loadMonaco={loadMonaco}
    />
  );
  await waitFor(() => {
    assert.equal(modelValue, "const external = 3;");
    assert.deepEqual(optionUpdates, [true]);
  });
  view.unmount();
  assert.equal(editorDisposed, 1);
  assert.equal(modelDisposed, 1);
});

test("Monaco editor exposes a retry when its lazy bundle fails to load", async () => {
  let attempts = 0;
  const loadMonaco = async () => {
    attempts += 1;
    throw new Error("chunk unavailable");
  };
  const view = render(
    <MonacoFileEditor path="/src/app.ts" value="" disabled={false} onChange={() => undefined} loadMonaco={loadMonaco} />
  );

  const retry = await view.findByRole("button", { name: "Retry editor" });
  assert.equal(attempts, 1);
  fireEvent.click(retry);
  await waitFor(() => assert.equal(attempts, 2));
});
