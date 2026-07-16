import { useEffect } from "react";
import { useDeviceIdentityLifecycle } from "./useDeviceIdentityLifecycle";
import { useSelectedTeamDefaults } from "./useSelectedTeamDefaults";
import { useWorkspaceBootstrap } from "./useWorkspaceBootstrap";

export function useAppBootstrapEffects({
  workspace,
  selectedRoomReadReceipt,
  deviceIdentity,
  selectedTeamDefaults
}: {
  workspace: Parameters<typeof useWorkspaceBootstrap>[0];
  selectedRoomReadReceipt: { selectedRoomId: string | null; markRoomRead: (roomId: string) => void };
  deviceIdentity: Parameters<typeof useDeviceIdentityLifecycle>[0];
  selectedTeamDefaults: Parameters<typeof useSelectedTeamDefaults>[0];
}) {
  const { selectedRoomId, markRoomRead } = selectedRoomReadReceipt;
  useWorkspaceBootstrap(workspace);
  useEffect(() => {
    if (!selectedRoomId) return;
    markRoomRead(selectedRoomId);
  }, [markRoomRead, selectedRoomId]);
  useDeviceIdentityLifecycle(deviceIdentity);
  useSelectedTeamDefaults(selectedTeamDefaults);
}
