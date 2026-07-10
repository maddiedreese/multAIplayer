import React, { type ComponentProps } from "react";
import { SidebarDrawer } from "./AppShellLayout";
import { ProfileDrawerPanel } from "./ProfileDrawerPanel";
import { RoomSettingsDrawerPanel } from "./RoomSettingsDrawerPanel";
import type { SidebarPanel } from "../types";

export function AppSidebarDrawer({
  activePanel,
  profileTitle,
  settingsTitle,
  profile,
  settings,
  onClose
}: {
  activePanel: SidebarPanel;
  profileTitle: string;
  settingsTitle: string;
  profile: ComponentProps<typeof ProfileDrawerPanel>;
  settings: ComponentProps<typeof RoomSettingsDrawerPanel>;
  onClose: () => void;
}) {
  if (!activePanel) return null;

  const isProfile = activePanel === "profile";

  return (
    <SidebarDrawer
      label={isProfile ? "Account" : "Room settings"}
      title={isProfile ? profileTitle : settingsTitle}
      onClose={onClose}
    >
      {isProfile ? (
        <ProfileDrawerPanel {...profile} />
      ) : (
        <RoomSettingsDrawerPanel {...settings} />
      )}
    </SidebarDrawer>
  );
}
