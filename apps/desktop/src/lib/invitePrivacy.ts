export function displayableInviteLink(link: string, containsRoomKey: boolean): string {
  return containsRoomKey ? "" : link;
}
