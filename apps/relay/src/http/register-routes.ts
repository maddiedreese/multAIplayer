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

type OpsRouteDependencies = Parameters<typeof registerOpsRoutes>[0];

type RelayRouteDependencies = Parameters<typeof registerAttachmentRoutes>[0] &
  Parameters<typeof registerDebugRoutes>[0] &
  Parameters<typeof registerDeviceRoutes>[0] &
  Parameters<typeof registerGitHubRoutes>[0] &
  Parameters<typeof registerInviteRoutes>[0] &
  Parameters<typeof registerInviteDeliveryRoutes>[0] &
  Parameters<typeof registerKeyPackageRoutes>[0] &
  Omit<OpsRouteDependencies, "attachmentBlobs"> &
  Parameters<typeof registerRoomRoutes>[0] &
  Parameters<typeof registerTeamRoutes>[0] & {
    opsAttachmentBlobs: OpsRouteDependencies["attachmentBlobs"];
  };

export function registerRelayRoutes(dependencies: RelayRouteDependencies) {
  registerGitHubRoutes(dependencies);
  registerDebugRoutes(dependencies);
  registerAttachmentRoutes(dependencies);
  registerInviteRoutes(dependencies);
  registerInviteDeliveryRoutes(dependencies);
  registerKeyPackageRoutes(dependencies);
  registerTeamRoutes(dependencies);
  registerDeviceRoutes(dependencies);
  registerDeviceAuthRoutes(dependencies);
  registerOpsRoutes({ ...dependencies, attachmentBlobs: dependencies.opsAttachmentBlobs });
  registerRoomRoutes(dependencies);
}
