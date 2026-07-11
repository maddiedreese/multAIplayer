import {
  useRoomMainColumnComposition,
  type RoomMainColumnCapabilities,
  type RoomMainColumnSources
} from "../hooks/useRoomMainColumnComposition";

export type { RoomMainColumnCapabilities, RoomMainColumnSources };

export function RoomMainColumnContainer({ sources }: { sources: RoomMainColumnSources }) {
  return useRoomMainColumnComposition({ sources });
}
