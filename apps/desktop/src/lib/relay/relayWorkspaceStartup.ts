export async function runRelayWorkspaceStartupBarrier(options: {
  recoverAdmissions: () => Promise<void>;
  continueSelection: () => void;
  onRecoveryFailure: (error: unknown) => void;
  isCurrent?: () => boolean;
}): Promise<boolean> {
  try {
    await options.recoverAdmissions();
  } catch (error) {
    if (options.isCurrent?.() === false) return false;
    options.onRecoveryFailure(error);
    return false;
  }
  if (options.isCurrent?.() === false) return false;
  options.continueSelection();
  return true;
}

export function canContinueSelectedWorkspaceAfterAdmissionRecovery(options: {
  failedAdmissions: ReadonlyArray<{ teamId: string; roomId: string }>;
  selectedTeamId: string;
  selectedRoomId: string | null;
}): boolean {
  if (options.selectedRoomId) {
    return !options.failedAdmissions.some((admission) => admission.roomId === options.selectedRoomId);
  }
  if (options.selectedTeamId) {
    return !options.failedAdmissions.some((admission) => admission.teamId === options.selectedTeamId);
  }
  return true;
}
