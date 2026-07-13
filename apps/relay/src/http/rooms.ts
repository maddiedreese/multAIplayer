import { registerRoomCreateRoute } from "./room-create-route.js";
import { registerRoomHostRoute } from "./room-host-route.js";
import { registerRoomLifecycleRoute } from "./room-lifecycle-route.js";
import { registerRoomSettingsRoute } from "./room-settings-route.js";
import type { RegisterRoomRoutesOptions } from "./room-route-types.js";

export function registerRoomRoutes(options: RegisterRoomRoutesOptions) {
  registerRoomCreateRoute(options);
  registerRoomHostRoute(options);
  registerRoomSettingsRoute(options);
  registerRoomLifecycleRoute(options);
}

export type { RegisterRoomRoutesOptions } from "./room-route-types.js";
