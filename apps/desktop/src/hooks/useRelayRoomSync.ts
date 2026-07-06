import { useRelayPublishers } from "./useRelayPublishers";
import { useRelaySubscription } from "./useRelaySubscription";

export function useRelayRoomSync({
  subscription,
  publishers
}: {
  subscription: Parameters<typeof useRelaySubscription>[0];
  publishers: Parameters<typeof useRelayPublishers>[0];
}) {
  useRelaySubscription(subscription);
  return useRelayPublishers(publishers);
}
