import type { useAppRefs } from "./useAppRefs";
import { createRoomActions } from "../application/rooms/roomActions";

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
    busy: {
      gitWorkflowBusyRef: appRefs.gitWorkflowBusyRef,
      actionsBusyRef: appRefs.actionsBusyRef,
      localPreviewBusyRef: appRefs.localPreviewBusyRef,
      hostBusyRef: appRefs.hostBusyRef,
      settingsBusyRef: appRefs.settingsBusyRef,
      membershipCommitBusyRef: appRefs.membershipCommitBusyRef,
      fileBusyRef: appRefs.fileBusyRef,
      terminalBusyRef: appRefs.terminalBusyRef
    },
    maxTerminalActivityLines,
    browser: {
      defaultBrowserUrl,
      defaultBrowserReason
    },
    project: {
      defaultCodexModel,
      defaultProjectPath
    }
  });
}
