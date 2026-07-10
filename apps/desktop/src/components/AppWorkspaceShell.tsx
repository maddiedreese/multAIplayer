import React, { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ShellResizer } from "./AppShellLayout";

interface AppWorkspaceShellProps {
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  shellStyle: CSSProperties;
  sidebar: ReactNode;
  drawer: ReactNode;
  main: ReactNode;
  inspector: ReactNode;
  dialog: ReactNode;
  shellBanner?: ReactNode;
  onBeginSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onBeginInspectorResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleSidebarCollapsed: () => void;
  onToggleInspectorCollapsed: () => void;
}

export function AppWorkspaceShell({
  sidebarCollapsed,
  inspectorCollapsed,
  shellStyle,
  sidebar,
  drawer,
  main,
  inspector,
  dialog,
  shellBanner,
  onBeginSidebarResize,
  onBeginInspectorResize,
  onToggleSidebarCollapsed,
  onToggleInspectorCollapsed
}: AppWorkspaceShellProps) {
  return (
    <div
      className={`app-shell ${shellBanner ? "has-shell-banner" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`}
      style={shellStyle}
    >
      {shellBanner && <div className="shell-banner-stack">{shellBanner}</div>}
      {sidebar}
      <ShellResizer
        side="left"
        collapsed={sidebarCollapsed}
        expandLabel="Expand sidebar"
        collapseLabel="Collapse sidebar"
        onBeginResize={onBeginSidebarResize}
        onToggleCollapsed={onToggleSidebarCollapsed}
      />
      {drawer}
      {main}
      <ShellResizer
        side="right"
        collapsed={inspectorCollapsed}
        expandLabel="Expand context column"
        collapseLabel="Collapse context column"
        onBeginResize={onBeginInspectorResize}
        onToggleCollapsed={onToggleInspectorCollapsed}
      />
      {inspector}
      {dialog}
    </div>
  );
}
