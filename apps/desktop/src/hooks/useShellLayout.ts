import { useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { clamp } from "../lib/appFormatters";
import { useAppStore } from "../store/appStore";

export function useShellLayout() {
  const { sidebarWidth, inspectorWidth, sidebarCollapsed, inspectorCollapsed } = useAppStore(useShallow((state) => ({
    sidebarWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
    sidebarCollapsed: state.sidebarCollapsed,
    inspectorCollapsed: state.inspectorCollapsed
  })));
  const {
    setSidebarWidth,
    setInspectorWidth,
    setSidebarCollapsed,
    setInspectorCollapsed,
    toggleSidebarCollapsed,
    toggleInspectorCollapsed
  } = useAppStore.getState();

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

  const shellStyle = useMemo(() => ({
    "--sidebar-width": sidebarCollapsed ? "52px" : `${sidebarWidth}px`,
    "--rail-width": inspectorCollapsed ? "52px" : `${inspectorWidth}px`
  } as CSSProperties), [inspectorCollapsed, inspectorWidth, sidebarCollapsed, sidebarWidth]);

  return {
    sidebarCollapsed,
    inspectorCollapsed,
    shellStyle,
    beginShellResize,
    toggleSidebarCollapsed,
    toggleInspectorCollapsed
  };
}
