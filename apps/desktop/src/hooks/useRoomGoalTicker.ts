import { useEffect } from "react";
import type { RoomGoal } from "../types";

export function useRoomGoalTicker(roomGoal: RoomGoal | null, onTickGoalElapsed: () => void) {
  useEffect(() => {
    if (roomGoal?.status !== "active") return undefined;
    const interval = window.setInterval(onTickGoalElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [onTickGoalElapsed, roomGoal?.id, roomGoal?.status]);
}
