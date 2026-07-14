import React, { type ComponentProps } from "react";
import { SidebarDrawer } from "./AppShellLayout";
import { ProfileDrawerPanel } from "./ProfileDrawerPanel";
import { RoomSettingsDrawerPanel } from "./RoomSettingsDrawerPanel";
import { HelpDrawerPanel } from "./HelpDrawerPanel";
import type { SidebarPanel } from "../types";

export function AppSidebarDrawer({
  activePanel,
  profileTitle,
  settingsTitle,
  profile,
  settings,
  help,
  onClose
}: {
  activePanel: SidebarPanel;
  profileTitle: string;
  settingsTitle: string;
  profile: ComponentProps<typeof ProfileDrawerPanel>;
  settings: ComponentProps<typeof RoomSettingsDrawerPanel>;
  help: ComponentProps<typeof HelpDrawerPanel>;
  onClose: () => void;
}) {
  if (!activePanel) return null;

  const label = activePanel === "profile" ? "Account" : activePanel === "help" ? "Help" : "Room settings";
  const title = activePanel === "profile" ? profileTitle : activePanel === "help" ? "Get help" : settingsTitle;

  return (
    <SidebarDrawer label={label} title={title} onClose={onClose}>
      {activePanel === "profile" ? (
        <ProfileDrawerPanel {...profile} />
      ) : activePanel === "help" ? (
        <HelpDrawerPanel {...help} />
      ) : (
        <RoomSettingsDrawerPanel {...settings} />
      )}
    </SidebarDrawer>
  );
}
