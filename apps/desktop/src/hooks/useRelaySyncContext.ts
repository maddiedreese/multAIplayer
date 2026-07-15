import { createCodexBrowserOpenCommand } from "../application/codex/codexBrowserOpenCommand";
import { useRelayRoomSync } from "./useRelayRoomSync";

export function useRelaySyncContext({
  browserOpenCommand,
  relayRoomSync
}: {
  browserOpenCommand: Parameters<typeof createCodexBrowserOpenCommand>[0];
  relayRoomSync: Omit<Parameters<typeof useRelayRoomSync>[0], "subscription"> & {
    subscription: Omit<Parameters<typeof useRelayRoomSync>[0]["subscription"], "handleCodexBrowserOpenCommand">;
  };
}) {
  const handleCodexBrowserOpenCommand = createCodexBrowserOpenCommand(browserOpenCommand);
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
