import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useTerminalAutoOpen } from "../src/hooks/useTerminalAutoOpen";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/"
});

Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, {
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement
});

afterEach(() => cleanup());

test("terminal auto-open retries when a room receives its project path", async () => {
  const openedPaths: string[] = [];
  const openInteractiveTerminal = async () => {
    openedPaths.push(currentProjectPath);
  };
  let currentProjectPath = "";

  const view = renderHook(
    ({ projectPath }: { projectPath: string }) => {
      const terminalAutoOpenedRoomsRef = useRef<Set<string>>(new Set());
      currentProjectPath = projectPath;
      useTerminalAutoOpen({
        inspectorTab: "terminal",
        hasSelectedRoom: true,
        isActiveHost: true,
        canReadLocalWorkspace: true,
        isSelectedRoomLocked: false,
        terminalBusy: false,
        roomTerminalCount: 0,
        selectedRoomId: "room-terminal",
        selectedRoomProjectPath: projectPath,
        terminalAutoOpenedRoomsRef,
        openInteractiveTerminal
      });
    },
    { initialProps: { projectPath: "" } }
  );

  await waitFor(() => assert.deepEqual(openedPaths, [""]));
  currentProjectPath = "/tmp/project";
  view.rerender({ projectPath: currentProjectPath });
  await waitFor(() => assert.deepEqual(openedPaths, ["", "/tmp/project"]));
  view.rerender({ projectPath: currentProjectPath });
  assert.deepEqual(openedPaths, ["", "/tmp/project"]);
});
