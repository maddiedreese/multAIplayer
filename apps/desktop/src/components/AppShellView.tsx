import type { ComponentProps, ReactNode } from "react";
import { AppSidebarDrawer } from "./AppSidebarDrawer";
import { AppWorkspaceShell } from "./AppWorkspaceShell";
import { DesktopSidebar } from "./DesktopSidebar";
import { LocalPreviewDialog } from "./LocalPreviewDialog";
import { RoomInspectorPanel } from "./RoomInspectorPanel";
import { RoomMainColumn } from "./RoomMainColumn";
import { isWebPreviewRuntime } from "../lib/appRuntime";
import { useUpdateNotice } from "../hooks/useUpdateNotice";

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
  const updateNotice = useUpdateNotice();
  const webPreviewBanner: ReactNode = isWebPreviewRuntime() ? (
    <div className="web-preview-banner" role="status">
      <strong>Development web preview</strong>
      <span>Do not use this fallback for private projects; room secrets use browser localStorage instead of the native Keychain.</span>
    </div>
  ) : null;
  const updateBanner: ReactNode = updateNotice ? (
    <div className={`update-banner ${updateNotice.security ? "security" : ""}`} role="status">
      <strong>{updateNotice.security ? "Security update available" : "Update available"}</strong>
      <span>
        {updateNotice.currentVersion} &rarr; {updateNotice.latestVersion}
        {updateNotice.notes ? `: ${updateNotice.notes}` : ""}
      </span>
      <button onClick={() => window.open(updateNotice.url, "_blank", "noopener,noreferrer")}>
        Download
      </button>
    </div>
  ) : null;
  const shellBanner: ReactNode = (
    <>
      {updateBanner}
      {webPreviewBanner}
    </>
  );

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
      shellBanner={updateBanner || webPreviewBanner ? shellBanner : null}
    />
  );
}
