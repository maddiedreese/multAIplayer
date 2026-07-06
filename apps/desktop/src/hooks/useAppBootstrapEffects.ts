import { useDeviceIdentityLifecycle } from "./useDeviceIdentityLifecycle";
import { useInviteUrlBootstrap } from "./useInviteUrlBootstrap";
import { useSelectedRoomReadReceipt } from "./useSelectedRoomReadReceipt";
import { useSelectedTeamDefaults } from "./useSelectedTeamDefaults";
import { useWorkspaceBootstrap } from "./useWorkspaceBootstrap";

export function useAppBootstrapEffects({
  workspace,
  selectedRoomReadReceipt,
  deviceIdentity,
  selectedTeamDefaults,
  inviteUrl
}: {
  workspace: Parameters<typeof useWorkspaceBootstrap>[0];
  selectedRoomReadReceipt: Parameters<typeof useSelectedRoomReadReceipt>[0];
  deviceIdentity: Parameters<typeof useDeviceIdentityLifecycle>[0];
  selectedTeamDefaults: Parameters<typeof useSelectedTeamDefaults>[0];
  inviteUrl: Parameters<typeof useInviteUrlBootstrap>[0];
}) {
  useWorkspaceBootstrap(workspace);
  useSelectedRoomReadReceipt(selectedRoomReadReceipt);
  useDeviceIdentityLifecycle(deviceIdentity);
  useSelectedTeamDefaults(selectedTeamDefaults);
  useInviteUrlBootstrap(inviteUrl);
}
