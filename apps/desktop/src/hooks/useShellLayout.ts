import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../lib/appFormatters";

export function useShellLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(372);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  function beginShellResize(side: "sidebar" | "inspector", event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "sidebar" ? sidebarWidth : inspectorWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      if (side === "sidebar") {
        setSidebarCollapsed(false);
        setSidebarWidth(clamp(startWidth + moveEvent.clientX - startX, 220, 380));
      } else {
        setInspectorCollapsed(false);
        setInspectorWidth(clamp(startWidth + startX - moveEvent.clientX, 320, 520));
      }
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  const shellStyle = {
    "--sidebar-width": sidebarCollapsed ? "52px" : `${sidebarWidth}px`,
    "--rail-width": inspectorCollapsed ? "52px" : `${inspectorWidth}px`
  } as CSSProperties;

  return {
    sidebarCollapsed,
    inspectorCollapsed,
    shellStyle,
    beginShellResize,
    toggleSidebarCollapsed: () => setSidebarCollapsed((collapsed) => !collapsed),
    toggleInspectorCollapsed: () => setInspectorCollapsed((collapsed) => !collapsed)
  };
}
