import React, { type ComponentProps } from "react";
import { MarkdownFallbackPanel } from "./MarkdownFallbackPanel";
import { RoomChatPanel } from "./RoomChatPanel";
import { RoomHeader } from "./RoomHeader";
import { RoomStatusBanners } from "./RoomStatusBanners";

interface RoomMainColumnProps {
  headerProps: ComponentProps<typeof RoomHeader>;
  statusProps: ComponentProps<typeof RoomStatusBanners>;
  markdownFallbackProps: ComponentProps<typeof MarkdownFallbackPanel> | null;
  chatProps: ComponentProps<typeof RoomChatPanel>;
}

export function RoomMainColumn({ headerProps, statusProps, markdownFallbackProps, chatProps }: RoomMainColumnProps) {
  return (
    <main className="room">
      <RoomHeader {...headerProps} />
      <RoomStatusBanners {...statusProps} />
      {markdownFallbackProps && <MarkdownFallbackPanel {...markdownFallbackProps} />}
      <RoomChatPanel {...chatProps} />
    </main>
  );
}
