import type { ComponentProps, ReactNode } from "react";
import { AppSidebarDrawer } from "./AppSidebarDrawer";
import { AppWorkspaceShell } from "./AppWorkspaceShell";
import { DesktopSidebar } from "./DesktopSidebar";
import { LocalPreviewDialog } from "./LocalPreviewDialog";
import { RoomInspectorPanel } from "./RoomInspectorPanel";
import { RoomMainColumn } from "./RoomMainColumn";
import { isWebPreviewRuntime } from "../lib/appRuntime";

type AppWorkspaceShellProps = ComponentProps<typeof AppWorkspaceShell>;

interface AppShellViewProps {
  sidebarCollapsed: AppWorkspaceShellProps["sidebarCollapsed"];
  inspectorCollapsed: AppWorkspaceShellProps["inspectorCollapsed"];
  shellStyle: AppWorkspaceShellProps["shellStyle"];
  onBeginSidebarResize: AppWorkspaceShellProps["onBeginSidebarResize"];
  onBeginInspectorResize: AppWorkspaceShellProps["onBeginInspectorResize"];
  onToggleSidebarCollapsed: AppWorkspaceShellProps["onToggleSidebarCollapsed"];
  onToggleInspectorCollapsed: AppWorkspaceShellProps["onToggleInspectorCollapsed"];
  sidebarProps: ComponentProps<typeof DesktopSidebar>;
  drawerProps: ComponentProps<typeof AppSidebarDrawer>;
  roomMainColumnProps: ComponentProps<typeof RoomMainColumn>;
  roomInspectorPanelProps: ComponentProps<typeof RoomInspectorPanel>;
  localPreviewDialogOpen: boolean;
  localPreviewDialogProps: ComponentProps<typeof LocalPreviewDialog>;
}

export function AppShellView({
  sidebarCollapsed,
  inspectorCollapsed,
  shellStyle,
  onBeginSidebarResize,
  onBeginInspectorResize,
  onToggleSidebarCollapsed,
  onToggleInspectorCollapsed,
  sidebarProps,
  drawerProps,
  roomMainColumnProps,
  roomInspectorPanelProps,
  localPreviewDialogOpen,
  localPreviewDialogProps
}: AppShellViewProps) {
  const dialog: ReactNode = localPreviewDialogOpen ? <LocalPreviewDialog {...localPreviewDialogProps} /> : null;
  const webPreviewBanner: ReactNode = isWebPreviewRuntime() ? (
    <div className="web-preview-banner" role="status">
      <strong>Development web preview</strong>
      <span>Do not use this fallback for private projects; room secrets use browser localStorage instead of the native Keychain.</span>
    </div>
  ) : null;

  return (
    <AppWorkspaceShell
      sidebarCollapsed={sidebarCollapsed}
      inspectorCollapsed={inspectorCollapsed}
      shellStyle={shellStyle}
      onBeginSidebarResize={onBeginSidebarResize}
      onBeginInspectorResize={onBeginInspectorResize}
      onToggleSidebarCollapsed={onToggleSidebarCollapsed}
      onToggleInspectorCollapsed={onToggleInspectorCollapsed}
      sidebar={<DesktopSidebar {...sidebarProps} />}
      drawer={<AppSidebarDrawer {...drawerProps} />}
      main={<RoomMainColumn {...roomMainColumnProps} />}
      inspector={<RoomInspectorPanel {...roomInspectorPanelProps} />}
      dialog={dialog}
      webPreviewBanner={webPreviewBanner}
    />
  );
}
