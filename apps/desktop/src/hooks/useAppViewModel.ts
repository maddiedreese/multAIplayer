import { createLocalPreviewInput } from "./appViewModelLocalPreview";
import { createRoomMainColumnInput } from "./appViewModelRoomMainColumn";
import { createRoomInspectorInput } from "./appViewModelRoomInspector";
import { createAppSidebarInput } from "./appViewModelSidebar";
import { createShellInput } from "./appViewModelShell";
import type { AppViewModelOptions } from "./appViewModelTypes";
import { useAppViewProps } from "./useAppViewProps";

export function useAppViewModel(options: AppViewModelOptions) {
  return useAppViewProps({
    shell: createShellInput(options),
    roomMainColumn: createRoomMainColumnInput(options),
    roomInspectorPanel: createRoomInspectorInput(options),
    appSidebar: createAppSidebarInput(options),
    localPreviewDialog: createLocalPreviewInput(options)
  });
}
