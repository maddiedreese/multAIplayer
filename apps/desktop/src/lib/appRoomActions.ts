import type { useAppRefs } from "../hooks/useAppRefs";
import { createRoomActions } from "./roomActions";

type AppRefs = ReturnType<typeof useAppRefs>;

export function createAppRoomActions({
  appRefs,
  maxTerminalActivityLines,
  defaultBrowserUrl,
  defaultBrowserReason,
  defaultCodexModel,
  defaultProjectPath
}: {
  appRefs: AppRefs;
  maxTerminalActivityLines: number;
  defaultBrowserUrl: string;
  defaultBrowserReason: string;
  defaultCodexModel: string;
  defaultProjectPath: string;
}) {
  return createRoomActions({
    selectedRoomIdRef: appRefs.selectedRoomIdRef,
    selectedTeamIdRef: appRefs.selectedTeamIdRef,
    busy: {
      gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
      actionsBusyRef: appRefs.actionsBusyRef,
      localPreviewBusyRef: appRefs.localPreviewBusyRef,
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      keyRotationBusyRef: appRefs.keyRotationBusyRef,
      fileBusyRef: appRefs.fileBusyRef,
      terminalBusyRef: appRefs.terminalBusyRef
    },
    maxTerminalActivityLines,
    browser: {
      defaultBrowserUrl,
      defaultBrowserReason
    },
    project: {
      roomsRef: appRefs.roomsRef,
      defaultCodexModel,
      defaultProjectPath
    }
  });
}
