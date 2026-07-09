import { createLocalPreviewInput } from "./appViewModelLocalPreview";
import { createRoomMainColumnInput } from "./appViewModelRoomMainColumn";
import { createRoomInspectorInput } from "./appViewModelRoomInspector";
import { createAppSidebarInput } from "./appViewModelSidebar";
import { createShellInput } from "./appViewModelShell";
import type { AppViewModelOptions } from "./appViewModelTypes";
import { useAppViewProps } from "./useAppViewProps";
import { useStableComposition } from "./useStableComposition";

export function useAppViewModel(options: AppViewModelOptions) {
  const shell = useStableComposition(createShellInput(options));
  const roomMainColumn = useStableComposition(createRoomMainColumnInput(options));
  const roomInspectorPanel = useStableComposition(createRoomInspectorInput(options));
  const appSidebar = useStableComposition(createAppSidebarInput(options));
  const localPreviewDialog = useStableComposition(createLocalPreviewInput(options));

  return useAppViewProps({
    shell,
    roomMainColumn,
    roomInspectorPanel,
    appSidebar,
    localPreviewDialog
  });
}
