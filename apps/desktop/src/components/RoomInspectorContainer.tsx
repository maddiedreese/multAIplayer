import {
  useRoomInspectorComposition,
  type RoomInspectorCapabilities,
  type RoomInspectorSources
} from "../hooks/useRoomInspectorComposition";

export type { RoomInspectorCapabilities, RoomInspectorSources };

export function RoomInspectorContainer({ sources }: { sources: RoomInspectorSources }) {
  return useRoomInspectorComposition({ sources });
}
