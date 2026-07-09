import { createLocalPreviewInput } from "./appViewModelLocalPreview";
import { createRoomMainColumnInput } from "./appViewModelRoomMainColumn";
import { createRoomInspectorInput } from "./appViewModelRoomInspector";
import { createAppSidebarInput } from "./appViewModelSidebar";
import { createShellInput } from "./appViewModelShell";
import type { AppViewModelOptions } from "./appViewModelTypes";
import { useAppViewProps } from "./useAppViewProps";
import { useStablePlainObjectComposition } from "./useStablePlainObjectComposition";

export function useAppViewModel(options: AppViewModelOptions) {
  const shell = useStablePlainObjectComposition(createShellInput(options));
  const roomMainColumn = useStablePlainObjectComposition(createRoomMainColumnInput(options));
  const roomInspectorPanel = useStablePlainObjectComposition(createRoomInspectorInput(options));
  const appSidebar = useStablePlainObjectComposition(createAppSidebarInput(options));
  const localPreviewDialog = useStablePlainObjectComposition(createLocalPreviewInput(options));

  return useAppViewProps({
    shell,
    roomMainColumn,
    roomInspectorPanel,
    appSidebar,
    localPreviewDialog
  });
}
