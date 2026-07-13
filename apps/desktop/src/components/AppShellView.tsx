import React, { type ReactNode } from "react";
import { AppWorkspaceShell } from "./AppWorkspaceShell";
import { LocalPreviewDialogContainer, type LocalPreviewDialogActions } from "./LocalPreviewDialogContainer";
import { RoomInspectorContainer, type RoomInspectorSources } from "./RoomInspectorContainer";
import { RoomMainColumnContainer, type RoomMainColumnSources } from "./RoomMainColumnContainer";
import { isWebPreviewRuntime } from "../lib/appRuntime";
import { useUpdateNotice } from "../hooks/useUpdateNotice";
import { useShellLayout } from "../hooks/useShellLayout";
import { AppSidebarDrawerContainer, DesktopSidebarContainer, type SidebarSources } from "./SidebarContainers";

interface AppShellViewProps {
  sidebarSources: SidebarSources;
  roomMainColumnSources: RoomMainColumnSources;
  roomInspectorSources: RoomInspectorSources;
  localPreviewDialogActions: LocalPreviewDialogActions;
}

export function AppShellView({
  sidebarSources,
  roomMainColumnSources,
  roomInspectorSources,
  localPreviewDialogActions
}: AppShellViewProps) {
  const shellLayout = useShellLayout();
  const dialog: ReactNode = <LocalPreviewDialogContainer {...localPreviewDialogActions} />;
  const updateNotice = useUpdateNotice();
  const webPreviewBanner: ReactNode = isWebPreviewRuntime() ? (
    <div className="web-preview-banner" role="status">
      <strong>Development web preview</strong>
      <span>
        Private MLS rooms are unavailable in this browser-only preview. Use the native desktop app for E2EE rooms.
      </span>
    </div>
  ) : null;
  const updateBanner: ReactNode = updateNotice ? (
    <div className={`update-banner ${updateNotice.security ? "security" : ""}`} role="status">
      <strong>{updateNotice.security ? "Security update available" : "Update available"}</strong>
      <span>
        {updateNotice.currentVersion} &rarr; {updateNotice.latestVersion}
        {updateNotice.notes ? `: ${updateNotice.notes}` : ""}
      </span>
      <button onClick={() => window.open(updateNotice.url, "_blank", "noopener,noreferrer")}>Download</button>
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
      sidebarCollapsed={shellLayout.sidebarCollapsed}
      inspectorCollapsed={shellLayout.inspectorCollapsed}
      shellStyle={shellLayout.shellStyle}
      onBeginSidebarResize={(event) => shellLayout.beginShellResize("sidebar", event)}
      onBeginInspectorResize={(event) => shellLayout.beginShellResize("inspector", event)}
      onToggleSidebarCollapsed={shellLayout.toggleSidebarCollapsed}
      onToggleInspectorCollapsed={shellLayout.toggleInspectorCollapsed}
      sidebar={<DesktopSidebarContainer sources={sidebarSources} />}
      drawer={<AppSidebarDrawerContainer sources={sidebarSources} />}
      main={<RoomMainColumnContainer sources={roomMainColumnSources} />}
      inspector={<RoomInspectorContainer sources={roomInspectorSources} />}
      dialog={dialog}
      shellBanner={updateBanner || webPreviewBanner ? shellBanner : null}
    />
  );
}
