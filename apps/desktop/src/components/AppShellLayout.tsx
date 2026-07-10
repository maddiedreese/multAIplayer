import { X } from "lucide-react";
import React, { type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

interface ShellResizerProps {
  side: "left" | "right";
  collapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onBeginResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleCollapsed: () => void;
}

export function ShellResizer({
  side,
  collapsed,
  expandLabel,
  collapseLabel,
  onBeginResize,
  onToggleCollapsed
}: ShellResizerProps) {
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <div
      className={`shell-resizer shell-resizer-${side}`}
      role="separator"
      aria-label={side === "left" ? "Resize sidebar" : "Resize context column"}
      aria-orientation="vertical"
      onPointerDown={onBeginResize}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggleCollapsed}
        aria-label={label}
        title={label}
      >
        {side === "left" ? (collapsed ? ">" : "<") : collapsed ? "<" : ">"}
      </button>
    </div>
  );
}

interface SidebarDrawerProps {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidebarDrawer({ label, title, onClose, children }: SidebarDrawerProps) {
  return (
    <aside className="sidebar-drawer">
      <div className="drawer-header">
        <div>
          <span>{label}</span>
          <strong>{title}</strong>
        </div>
        <button onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
      </div>
      {children}
    </aside>
  );
}
