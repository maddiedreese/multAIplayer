import type { ComponentProps } from "react";
import { AppShellView } from "../components/AppShellView";
import { useAppSidebarProps } from "./useAppSidebarProps";
import { useLocalPreviewDialogProps } from "./useLocalPreviewDialogProps";
import { useRoomInspectorPanelProps } from "./useRoomInspectorPanelProps";
import { useRoomMainColumnProps } from "./useRoomMainColumnProps";

type AppShellViewProps = ComponentProps<typeof AppShellView>;

export function useAppViewProps({
  shell,
  roomMainColumn,
  roomInspectorPanel,
  appSidebar,
  localPreviewDialog
}: {
  shell: Pick<
    AppShellViewProps,
    | "sidebarCollapsed"
    | "inspectorCollapsed"
    | "shellStyle"
    | "onBeginSidebarResize"
    | "onBeginInspectorResize"
    | "onToggleSidebarCollapsed"
    | "onToggleInspectorCollapsed"
  >;
  roomMainColumn: Parameters<typeof useRoomMainColumnProps>[0];
  roomInspectorPanel: Parameters<typeof useRoomInspectorPanelProps>[0];
  appSidebar: Parameters<typeof useAppSidebarProps>[0];
  localPreviewDialog: Parameters<typeof useLocalPreviewDialogProps>[0];
}) {
  const roomMainColumnProps = useRoomMainColumnProps(roomMainColumn);
  const roomInspectorPanelProps = useRoomInspectorPanelProps(roomInspectorPanel);
  const { sidebarProps, drawerProps } = useAppSidebarProps(appSidebar);
  const { localPreviewDialogOpen, localPreviewDialogProps } = useLocalPreviewDialogProps(localPreviewDialog);

  return {
    appShellViewProps: {
      ...shell,
      sidebarProps,
      drawerProps,
      roomMainColumnProps,
      roomInspectorPanelProps,
      localPreviewDialogOpen,
      localPreviewDialogProps
    }
  };
}
