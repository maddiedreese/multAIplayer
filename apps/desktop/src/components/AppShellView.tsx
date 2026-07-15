import React, { type ReactNode } from "react";
import { AppWorkspaceShell } from "./AppWorkspaceShell";
import { LocalPreviewDialogContainer, type LocalPreviewDialogActions } from "./LocalPreviewDialogContainer";
import { RoomInspectorContainer, type RoomInspectorSources } from "./RoomInspectorContainer";
import { RoomMainColumnContainer, type RoomMainColumnSources } from "./RoomMainColumnContainer";
import { useUpdateNotice } from "../hooks/useUpdateNotice";
import { useShellLayout } from "../hooks/useShellLayout";
import { AppSidebarDrawerContainer, DesktopSidebarContainer, type SidebarSources } from "./SidebarContainers";
import { SignedUpdateBanner, UpdateVerificationWarning } from "./SignedUpdateBanner";

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
  const { notice: updateNotice, checkStatus, installStatus, install: installUpdate } = useUpdateNotice();
  const updateBanner: ReactNode = updateNotice ? (
    <SignedUpdateBanner notice={updateNotice} installStatus={installStatus} onInstall={installUpdate} />
  ) : null;
  const verificationWarning: ReactNode = checkStatus === "unverified" ? <UpdateVerificationWarning /> : null;
  const shellBanner: ReactNode = (
    <>
      {verificationWarning}
      {updateBanner}
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
      shellBanner={updateBanner || verificationWarning ? shellBanner : null}
    />
  );
}
