import { useRoomBrowserSetters } from "./useRoomBrowserSetters";
import { useRoomBusySetters } from "./useRoomBusySetters";
import { useRoomCodexApprovalSetters } from "./useRoomCodexApprovalSetters";
import { useRoomDraftSetters } from "./useRoomDraftSetters";
import { useRoomEventAppenders } from "./useRoomEventAppenders";
import { useRoomFileSetters } from "./useRoomFileSetters";
import { useRoomGitSetters } from "./useRoomGitSetters";
import { useRoomInviteSetters } from "./useRoomInviteSetters";
import { useRoomMessageSetters } from "./useRoomMessageSetters";
import { useRoomProjectSetters } from "./useRoomProjectSetters";
import { useRoomRequestSetters } from "./useRoomRequestSetters";
import { useRoomTerminalSetters } from "./useRoomTerminalSetters";

export function useRoomScopedSetters({
  messages,
  busy,
  files,
  terminals,
  codexApprovals,
  browser,
  invites,
  drafts,
  project,
  git,
  events,
  requests
}: {
  messages: Parameters<typeof useRoomMessageSetters>[0];
  busy: Parameters<typeof useRoomBusySetters>[0];
  files: Parameters<typeof useRoomFileSetters>[0];
  terminals: Parameters<typeof useRoomTerminalSetters>[0];
  codexApprovals: Parameters<typeof useRoomCodexApprovalSetters>[0];
  browser: Parameters<typeof useRoomBrowserSetters>[0];
  invites: Parameters<typeof useRoomInviteSetters>[0];
  drafts: Parameters<typeof useRoomDraftSetters>[0];
  project: Parameters<typeof useRoomProjectSetters>[0];
  git: Parameters<typeof useRoomGitSetters>[0];
  events: Parameters<typeof useRoomEventAppenders>[0];
  requests: Parameters<typeof useRoomRequestSetters>[0];
}) {
  return {
    ...useRoomMessageSetters(messages),
    ...useRoomBusySetters(busy),
    ...useRoomFileSetters(files),
    ...useRoomTerminalSetters(terminals),
    ...useRoomCodexApprovalSetters(codexApprovals),
    ...useRoomBrowserSetters(browser),
    ...useRoomInviteSetters(invites),
    ...useRoomDraftSetters(drafts),
    ...useRoomProjectSetters(project),
    ...useRoomGitSetters(git),
    ...useRoomEventAppenders(events),
    ...useRoomRequestSetters(requests)
  };
}
