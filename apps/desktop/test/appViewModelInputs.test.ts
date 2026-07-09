import assert from "node:assert/strict";
import test from "node:test";
import { createLocalPreviewInput } from "../src/hooks/appViewModelLocalPreview";
import { createShellInput } from "../src/hooks/appViewModelShell";

test("shell view-model input delegates resizing to the correct shell edge", () => {
  const resizeEdges: string[] = [];
  const toggleSidebarCollapsed = () => undefined;
  const toggleInspectorCollapsed = () => undefined;
  const options = {
    appState: {
      shellLayout: {
        sidebarCollapsed: true,
        inspectorCollapsed: false,
        shellStyle: { "--sidebar-width": "280px" },
        beginShellResize: (edge: string) => resizeEdges.push(edge),
        toggleSidebarCollapsed,
        toggleInspectorCollapsed
      }
    }
  } as unknown as Parameters<typeof createShellInput>[0];

  const input = createShellInput(options);
  input.onBeginSidebarResize({} as never);
  input.onBeginInspectorResize({} as never);

  assert.deepEqual(resizeEdges, ["sidebar", "inspector"]);
  assert.equal(input.sidebarCollapsed, true);
  assert.equal(input.inspectorCollapsed, false);
  assert.equal(input.onToggleSidebarCollapsed, toggleSidebarCollapsed);
  assert.equal(input.onToggleInspectorCollapsed, toggleInspectorCollapsed);
});

test("local preview view-model input preserves state and runtime action ownership", () => {
  const dialog = { open: true };
  const close = () => undefined;
  const setSelectedUrl = () => undefined;
  const setManualUrl = () => undefined;
  const setPhase = () => undefined;
  const prepare = async () => undefined;
  const confirm = async () => undefined;
  const options = {
    appState: {
      localPreviewState: {
        localPreviewDialog: dialog,
        closeLocalPreviewDialog: close,
        setLocalPreviewDialogSelectedUrl: setSelectedUrl,
        setLocalPreviewDialogManualUrl: setManualUrl,
        setLocalPreviewDialogPhase: setPhase
      }
    },
    selectedRuntime: { localPreviewBusy: true },
    roomRuntime: {
      prepareLocalPreviewConfirmation: prepare,
      confirmLocalPreviewShare: confirm
    }
  } as unknown as Parameters<typeof createLocalPreviewInput>[0];

  const input = createLocalPreviewInput(options);

  assert.equal(input.localPreviewDialog, dialog);
  assert.equal(input.localPreviewBusy, true);
  assert.equal(input.closeLocalPreviewDialog, close);
  assert.equal(input.setLocalPreviewDialogSelectedUrl, setSelectedUrl);
  assert.equal(input.setLocalPreviewDialogManualUrl, setManualUrl);
  assert.equal(input.setLocalPreviewDialogPhase, setPhase);
  assert.equal(input.prepareLocalPreviewConfirmation, prepare);
  assert.equal(input.confirmLocalPreviewShare, confirm);
});
