import type { AppViewModelOptions } from "./appViewModelTypes";
import type { useAppViewProps } from "./useAppViewProps";

type ShellInput = Parameters<typeof useAppViewProps>[0]["shell"];

export function createShellInput({ appState }: Pick<AppViewModelOptions, "appState">): ShellInput {
  const { shellLayout } = appState;

  return {
    sidebarCollapsed: shellLayout.sidebarCollapsed,
    inspectorCollapsed: shellLayout.inspectorCollapsed,
    shellStyle: shellLayout.shellStyle,
    onBeginSidebarResize: (event) => shellLayout.beginShellResize("sidebar", event),
    onBeginInspectorResize: (event) => shellLayout.beginShellResize("inspector", event),
    onToggleSidebarCollapsed: shellLayout.toggleSidebarCollapsed,
    onToggleInspectorCollapsed: shellLayout.toggleInspectorCollapsed
  };
}
