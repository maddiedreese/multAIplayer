import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
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
  webPreviewBanner?: ReactNode;
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
  webPreviewBanner,
  onBeginSidebarResize,
  onBeginInspectorResize,
  onToggleSidebarCollapsed,
  onToggleInspectorCollapsed
}: AppWorkspaceShellProps) {
  return (
    <div
      className={`app-shell ${webPreviewBanner ? "has-web-preview-banner" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`}
      style={shellStyle}
    >
      {webPreviewBanner}
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
