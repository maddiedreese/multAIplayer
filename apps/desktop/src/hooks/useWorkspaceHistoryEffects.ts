import { useHistorySearch } from "./useHistorySearch";
import { useLocalHistoryHydration } from "./useLocalHistoryHydration";

export function useWorkspaceHistoryEffects({
  hydration,
  search
}: {
  hydration: Parameters<typeof useLocalHistoryHydration>[0];
  search: Parameters<typeof useHistorySearch>[0];
}) {
  useLocalHistoryHydration(hydration);
  useHistorySearch(search);
}
