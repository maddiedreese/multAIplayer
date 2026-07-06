import { useAppSidebarProps } from "./useAppSidebarProps";
import { useLocalPreviewDialogProps } from "./useLocalPreviewDialogProps";
import { useRoomInspectorPanelProps } from "./useRoomInspectorPanelProps";
import { useRoomMainColumnProps } from "./useRoomMainColumnProps";

export function useAppViewProps({
  roomMainColumn,
  roomInspectorPanel,
  appSidebar,
  localPreviewDialog
}: {
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
    roomMainColumnProps,
    roomInspectorPanelProps,
    sidebarProps,
    drawerProps,
    localPreviewDialogOpen,
    localPreviewDialogProps
  };
}
