import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime } from "./runtime";
import type {
  CloudflaredProbe,
  LocalPreviewDetectedServer,
  LocalPreviewStartResult,
  LocalPreviewStatusResult,
  LocalPreviewStopResult
} from "./types";

export async function detectLocalPreviewServers(): Promise<LocalPreviewDetectedServer[]> {
  if (isTauriRuntime()) {
    return invokeNative<LocalPreviewDetectedServer[]>("detect_local_preview_servers");
  }

  return [
    { url: "http://localhost:5173/", host: "localhost", port: 5173 },
    { url: "http://127.0.0.1:3000/", host: "127.0.0.1", port: 3000 }
  ];
}

export async function probeCloudflared(): Promise<CloudflaredProbe> {
  if (isTauriRuntime()) {
    return invokeNative<CloudflaredProbe>("probe_cloudflared");
  }

  return {
    available: false,
    version: null,
    error: "Preview mode: install cloudflared in the native app to start Quick Tunnels."
  };
}

export async function startLocalPreviewTunnel(id: string, localUrl: string): Promise<LocalPreviewStartResult> {
  if (isTauriRuntime()) {
    return invokeNative<LocalPreviewStartResult>("local_preview_start", {
      request: { id, localUrl }
    });
  }

  return {
    id,
    localUrl,
    publicUrl: "https://example.trycloudflare.com",
    startupLog: "Preview mode: native app starts cloudflared."
  };
}

export async function stopLocalPreviewTunnel(id: string): Promise<LocalPreviewStopResult> {
  if (isTauriRuntime()) {
    return invokeNative<LocalPreviewStopResult>("local_preview_stop", { id });
  }

  return {
    id,
    localUrl: "http://localhost:5173/",
    publicUrl: "https://example.trycloudflare.com",
    stopped: true
  };
}

export async function readLocalPreviewTunnelStatus(id: string): Promise<LocalPreviewStatusResult> {
  if (isTauriRuntime()) {
    return invokeNative<LocalPreviewStatusResult>("local_preview_status", { id });
  }

  return {
    id,
    localUrl: "http://localhost:5173/",
    publicUrl: "https://example.trycloudflare.com",
    running: true,
    localReachable: true,
    exitStatus: null
  };
}
