import { useState } from "react";
import type { BrowserAccessRequest, BrowserStatus } from "../types";

export function useBrowserPanelState() {
  const [browserRequestsByRoom, setBrowserRequestsByRoom] = useState<Record<string, BrowserAccessRequest[]>>({});
  const [browserUrlsByRoom, setBrowserUrlsByRoom] = useState<Record<string, string>>({});
  const [browserReasonsByRoom, setBrowserReasonsByRoom] = useState<Record<string, string>>({});
  const [browserMessagesByRoom, setBrowserMessagesByRoom] = useState<Record<string, string | null>>({});
  const [browserStatusByRoom, setBrowserStatusByRoom] = useState<Record<string, BrowserStatus>>({});
  const [activeBrowserUrlsByRoom, setActiveBrowserUrlsByRoom] = useState<Record<string, string | null>>({});

  return {
    browserRequestsByRoom,
    setBrowserRequestsByRoom,
    browserUrlsByRoom,
    setBrowserUrlsByRoom,
    browserReasonsByRoom,
    setBrowserReasonsByRoom,
    browserMessagesByRoom,
    setBrowserMessagesByRoom,
    browserStatusByRoom,
    setBrowserStatusByRoom,
    activeBrowserUrlsByRoom,
    setActiveBrowserUrlsByRoom
  };
}
