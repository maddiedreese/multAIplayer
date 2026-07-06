import type { ComponentProps } from "react";
import { AppShellView } from "../components/AppShellView";
import { useAppSidebarProps } from "./useAppSidebarProps";
import { useLocalPreviewDialogProps } from "./useLocalPreviewDialogProps";
import { useRoomInspectorPanelProps } from "./useRoomInspectorPanelProps";
import { useRoomMainColumnProps } from "./useRoomMainColumnProps";

type AppShellViewProps = ComponentProps<typeof AppShellView>;
type RoomMainColumnOptions = Parameters<typeof useRoomMainColumnProps>[0];
type AppSidebarOptions = Parameters<typeof useAppSidebarProps>[0];

type RoomMainColumnInput = Omit<
  RoomMainColumnOptions,
  | "teams"
  | "selectedMessageCount"
  | "pendingAttachmentCount"
  | "onRetryMarkdownCopy"
  | "onDismissMarkdownFallback"
> & {
  teamRecords: RoomMainColumnOptions["teams"];
  selectedMessages: readonly unknown[];
  pendingAttachmentsForCount: readonly unknown[];
  copyMarkdownWithFallback: (
    title: string,
    markdown: string,
    onMessage: (message: string) => void,
    roomId?: string
  ) => Promise<void> | void;
  setChatMessageForRoom: (roomId: string, message: string) => void;
  setMarkdownCopyFallbackForRoom: (
    roomId: string,
    fallback: RoomMainColumnOptions["markdownCopyFallback"]
  ) => void;
};

type AppSidebarInput = Omit<AppSidebarOptions, "selectedTeam" | "settingsMessage" | "roomSources"> & {
  selectedTeamId: string;
  appConfigMessage: string | null;
  roomSettingsMessage: string | null;
  historyMessage: string | null;
  roomRecords: Array<{ id: string; teamId: string }>;
};

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
  roomMainColumn: RoomMainColumnInput;
  roomInspectorPanel: Parameters<typeof useRoomInspectorPanelProps>[0];
  appSidebar: AppSidebarInput;
  localPreviewDialog: Parameters<typeof useLocalPreviewDialogProps>[0];
}) {
  const {
    teamRecords,
    selectedMessages,
    pendingAttachmentsForCount,
    copyMarkdownWithFallback,
    setChatMessageForRoom,
    setMarkdownCopyFallbackForRoom,
    ...roomMainColumnOptions
  } = roomMainColumn;
  const roomMainColumnProps = useRoomMainColumnProps({
    ...roomMainColumnOptions,
    teams: teamRecords.map((team) => ({ id: team.id, name: team.name })),
    selectedMessageCount: selectedMessages.length,
    pendingAttachmentCount: pendingAttachmentsForCount.length,
    onRetryMarkdownCopy: (title, markdown) => copyMarkdownWithFallback(
      title,
      markdown,
      (message) => setChatMessageForRoom(roomMainColumnOptions.selectedRoom.id, message),
      roomMainColumnOptions.selectedRoom.id
    ),
    onDismissMarkdownFallback: () =>
      setMarkdownCopyFallbackForRoom(roomMainColumnOptions.selectedRoom.id, null)
  });
  const roomInspectorPanelProps = useRoomInspectorPanelProps(roomInspectorPanel);
  const {
    selectedTeamId,
    appConfigMessage,
    roomSettingsMessage,
    historyMessage,
    roomRecords,
    ...appSidebarOptions
  } = appSidebar;
  const { sidebarProps, drawerProps } = useAppSidebarProps({
    ...appSidebarOptions,
    selectedTeam: Boolean(selectedTeamId),
    settingsMessage: appConfigMessage ?? roomSettingsMessage ?? historyMessage,
    roomSources: roomRecords.map((room) => ({ id: room.id, teamId: room.teamId }))
  });
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
