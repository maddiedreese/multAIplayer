import { useCodexBrowserOpenCommand } from "./useCodexBrowserOpenCommand";
import { useRelayRoomSync } from "./useRelayRoomSync";

export function useRelaySyncContext({
  browserOpenCommand,
  relayRoomSync
}: {
  browserOpenCommand: Parameters<typeof useCodexBrowserOpenCommand>[0];
  relayRoomSync: Omit<Parameters<typeof useRelayRoomSync>[0], "subscription"> & {
    subscription: Omit<Parameters<typeof useRelayRoomSync>[0]["subscription"], "handleCodexBrowserOpenCommand">;
  };
}) {
  const { handleCodexBrowserOpenCommand } = useCodexBrowserOpenCommand(browserOpenCommand);
  const relayPublishers = useRelayRoomSync({
    ...relayRoomSync,
    subscription: {
      ...relayRoomSync.subscription,
      handleCodexBrowserOpenCommand
    }
  });

  return {
    handleCodexBrowserOpenCommand,
    ...relayPublishers
  };
}
