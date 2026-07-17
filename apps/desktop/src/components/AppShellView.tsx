import React, { type ReactNode } from "react";
import { ActiveRoomInspector, type RoomInspectorSources } from "./ActiveRoomInspector";
import { ActiveRoomMainColumn, type RoomMainColumnSources } from "./ActiveRoomMainColumn";
import { AppWorkspaceShell } from "./AppWorkspaceShell";
import { LocalPreviewDialogContainer, type LocalPreviewDialogActions } from "./LocalPreviewDialogContainer";
import { useUpdateNotice } from "../hooks/useUpdateNotice";
import { useShellLayout } from "../hooks/useShellLayout";
import { AppSidebarDrawerContainer, DesktopSidebarContainer, type SidebarSources } from "./SidebarContainers";
import { SignedUpdateBanner, UpdateVerificationWarning } from "./SignedUpdateBanner";
import { useAppStore } from "../store/appStore";

interface AppShellViewProps {
  sidebarSources: SidebarSources;
  roomMainColumnSources: RoomMainColumnSources;
  roomInspectorSources: RoomInspectorSources;
  localPreviewDialogActions: LocalPreviewDialogActions;
}

export function RoomMainColumnContainer({ sources }: { sources: RoomMainColumnSources }) {
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  if (!selectedRoom) {
    return (
      <main className="room">
        <div className="empty-state">Select or create a room to start collaborating.</div>
      </main>
    );
  }
  return <ActiveRoomMainColumn sources={sources} selectedRoom={selectedRoom} />;
}

function RoomInspector({ sources }: { sources: RoomInspectorSources }) {
  const selectedRoom = useAppStore((state) => state.rooms.find((room) => room.id === state.selectedRoomId));
  if (!selectedRoom) return <aside className="inspector" aria-label="Room inspector" />;
  return <ActiveRoomInspector sources={sources} selectedRoom={selectedRoom} />;
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
      inspector={<RoomInspector sources={roomInspectorSources} />}
      dialog={dialog}
      shellBanner={updateBanner || verificationWarning ? shellBanner : null}
    />
  );
}
