import { registerAttachmentRoutes } from "./attachments.js";
import { registerDebugRoutes } from "./debug.js";
import { registerDeviceRoutes } from "./devices.js";
import { registerDeviceAuthRoutes } from "./device-auth.js";
import { registerGitHubRoutes } from "./github.js";
import { registerInviteRoutes } from "./invites.js";
import { registerInviteDeliveryRoutes } from "./invite-delivery.js";
import { registerKeyPackageRoutes } from "./key-packages.js";
import { registerOpsRoutes } from "./ops.js";
import { registerRoomRoutes } from "./rooms.js";
import { registerTeamRoutes } from "./teams.js";

/**
 * Route registrars intentionally receive independent, route-sized option bags.
 * This keeps adding a dependency to one route family from silently making it
 * available to every other HTTP handler.
 */
export interface RelayRouteRegistrations {
  github: Parameters<typeof registerGitHubRoutes>[0];
  debug: Parameters<typeof registerDebugRoutes>[0];
  attachments: Parameters<typeof registerAttachmentRoutes>[0];
  invites: Parameters<typeof registerInviteRoutes>[0];
  inviteDelivery: Parameters<typeof registerInviteDeliveryRoutes>[0];
  keyPackages: Parameters<typeof registerKeyPackageRoutes>[0];
  teams: Parameters<typeof registerTeamRoutes>[0];
  devices: Parameters<typeof registerDeviceRoutes>[0];
  deviceAuth: Parameters<typeof registerDeviceAuthRoutes>[0];
  operations: Parameters<typeof registerOpsRoutes>[0];
  rooms: Parameters<typeof registerRoomRoutes>[0];
}

export function registerRelayRoutes(routes: RelayRouteRegistrations) {
  registerGitHubRoutes(routes.github);
  registerDebugRoutes(routes.debug);
  registerAttachmentRoutes(routes.attachments);
  registerInviteRoutes(routes.invites);
  registerInviteDeliveryRoutes(routes.inviteDelivery);
  registerKeyPackageRoutes(routes.keyPackages);
  registerTeamRoutes(routes.teams);
  registerDeviceRoutes(routes.devices);
  registerDeviceAuthRoutes(routes.deviceAuth);
  registerOpsRoutes(routes.operations);
  registerRoomRoutes(routes.rooms);
}
