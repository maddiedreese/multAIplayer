import { useDeviceIdentityLifecycle } from "./useDeviceIdentityLifecycle";
import { useSelectedRoomReadReceipt } from "./useSelectedRoomReadReceipt";
import { useSelectedTeamDefaults } from "./useSelectedTeamDefaults";
import { useWorkspaceBootstrap } from "./useWorkspaceBootstrap";

export function useAppBootstrapEffects({
  workspace,
  selectedRoomReadReceipt,
  deviceIdentity,
  selectedTeamDefaults
}: {
  workspace: Parameters<typeof useWorkspaceBootstrap>[0];
  selectedRoomReadReceipt: Parameters<typeof useSelectedRoomReadReceipt>[0];
  deviceIdentity: Parameters<typeof useDeviceIdentityLifecycle>[0];
  selectedTeamDefaults: Parameters<typeof useSelectedTeamDefaults>[0];
}) {
  useWorkspaceBootstrap(workspace);
  useSelectedRoomReadReceipt(selectedRoomReadReceipt);
  useDeviceIdentityLifecycle(deviceIdentity);
  useSelectedTeamDefaults(selectedTeamDefaults);
}
