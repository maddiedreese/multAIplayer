export const closeRoomBrowserSurfaceEvent = "multaiplayer:close-room-browser-surface";

export function closeRoomBrowserSurface() {
  window.dispatchEvent(new Event(closeRoomBrowserSurfaceEvent));
}
