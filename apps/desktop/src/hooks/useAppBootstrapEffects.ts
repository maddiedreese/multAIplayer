import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useDeviceIdentityLifecycle } from "./useDeviceIdentityLifecycle";
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
  selectedTeamDefaults: { selectedTeam: string };
}) {
  const { selectedRoomId, markRoomRead } = selectedRoomReadReceipt;
  const { selectedTeam } = selectedTeamDefaults;
  const loadDefaultsForTeam = useAppStore((state) => state.loadDefaultsForTeam);
  useWorkspaceBootstrap(workspace);
  useEffect(() => {
    if (!selectedRoomId) return;
    markRoomRead(selectedRoomId);
  }, [markRoomRead, selectedRoomId]);
  useDeviceIdentityLifecycle(deviceIdentity);
  useEffect(() => {
    if (!selectedTeam) return;
    loadDefaultsForTeam(selectedTeam);
  }, [loadDefaultsForTeam, selectedTeam]);
}
