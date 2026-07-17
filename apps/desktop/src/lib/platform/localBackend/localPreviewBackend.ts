import { invokeNative } from "../nativeCommandError";

import { isTauriRuntime, requireNativeRuntime } from "./runtime";
import type {
  CloudflaredProbe,
  LocalPreviewDetectedServer,
  LocalPreviewStartResult,
  LocalPreviewStatusResult,
  LocalPreviewStopResult
} from "./types";

export async function detectLocalPreviewServers(): Promise<LocalPreviewDetectedServer[]> {
  if (!isTauriRuntime()) return requireNativeRuntime("Local preview detection");
  return invokeNative<LocalPreviewDetectedServer[]>("detect_local_preview_servers");
}

export async function probeCloudflared(): Promise<CloudflaredProbe> {
  if (!isTauriRuntime()) return requireNativeRuntime("Cloudflared detection");
  return invokeNative<CloudflaredProbe>("probe_cloudflared");
}

export async function startLocalPreviewTunnel(id: string, localUrl: string): Promise<LocalPreviewStartResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Local preview tunnels");
  return invokeNative<LocalPreviewStartResult>("local_preview_start", {
    request: { id, localUrl }
  });
}

export async function stopLocalPreviewTunnel(id: string): Promise<LocalPreviewStopResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Local preview tunnels");
  return invokeNative<LocalPreviewStopResult>("local_preview_stop", { id });
}

export async function stopAllLocalPreviewTunnels(): Promise<number> {
  if (!isTauriRuntime()) return requireNativeRuntime("Local preview tunnels");
  return invokeNative<number>("local_preview_stop_all");
}

export async function readLocalPreviewTunnelStatus(id: string): Promise<LocalPreviewStatusResult> {
  if (!isTauriRuntime()) return requireNativeRuntime("Local preview tunnels");
  return invokeNative<LocalPreviewStatusResult>("local_preview_status", { id });
}
