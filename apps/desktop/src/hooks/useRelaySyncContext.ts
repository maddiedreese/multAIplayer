import { createCodexBrowserOpenCommand } from "../application/codex/codexBrowserOpenCommand";
import { useRelayPublishers } from "./useRelayPublishers";
import { useRelaySubscription } from "./relay/useRelaySubscription";

export function useRelaySyncContext({
  browserOpenCommand,
  relayRoomSync
}: {
  browserOpenCommand: Parameters<typeof createCodexBrowserOpenCommand>[0];
  relayRoomSync: {
    subscription: Omit<Parameters<typeof useRelaySubscription>[0], "handleCodexBrowserOpenCommand">;
    publishers: Parameters<typeof useRelayPublishers>[0];
  };
}) {
  const handleCodexBrowserOpenCommand = createCodexBrowserOpenCommand(browserOpenCommand);
  useRelaySubscription({
    ...relayRoomSync.subscription,
    handleCodexBrowserOpenCommand
  });
  const relayPublishers = useRelayPublishers(relayRoomSync.publishers);

  return {
    handleCodexBrowserOpenCommand,
    ...relayPublishers
  };
}
