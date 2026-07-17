import { useCallback, useEffect, useState } from "react";
import {
  getGitHubRepositoryAccessStatus,
  githubDevicePollDelayMs,
  nextGitHubDevicePollIntervalSeconds,
  pollGitHubRepositoryDeviceFlow,
  startGitHubRepositoryDeviceFlow,
  type GitHubDeviceStart
} from "../lib/identity/authClient";
import { openTrustedAuthenticationUrl } from "../lib/identity/authExternalUrl";
import { invokeNative } from "../lib/platform/nativeCommandError";

export function useGitHubRepositoryAccess(signedIn: boolean) {
  const [authorized, setAuthorized] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [flow, setFlow] = useState<GitHubDeviceStart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(false);
    if (!signedIn) {
      setAuthorized(false);
      setFlow(null);
      setResolved(true);
      return () => {
        cancelled = true;
      };
    }
    getGitHubRepositoryAccessStatus()
      .then((value) => {
        if (!cancelled) setAuthorized(value);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      })
      .finally(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: number | undefined;
    let intervalSeconds = Math.max(1, flow.interval);
    const poll = () => {
      if (Date.now() >= flow.expiresAt) {
        setError("The GitHub authorization code expired. Start again.");
        setFlow(null);
        return;
      }
      pollGitHubRepositoryDeviceFlow(flow.flow_id)
        .then((result) => {
          if (cancelled) return;
          if (result.status === "complete") {
            setAuthorized(true);
            setFlow(null);
            setError(null);
            return;
          }
          intervalSeconds = nextGitHubDevicePollIntervalSeconds(intervalSeconds, result);
          timer = window.setTimeout(poll, githubDevicePollDelayMs(intervalSeconds, flow.expiresAt));
        })
        .catch((cause) => {
          if (cancelled) return;
          setError(String(cause));
          setFlow(null);
        });
    };
    timer = window.setTimeout(poll, githubDevicePollDelayMs(intervalSeconds, flow.expiresAt));
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [flow]);

  const begin = useCallback(async () => {
    setError(null);
    try {
      const nextFlow = await startGitHubRepositoryDeviceFlow();
      setFlow(nextFlow);
      if (!(await openTrustedAuthenticationUrl("github", nextFlow.verification_uri))) {
        setError("Open github.com/login/device and enter the code shown below.");
      }
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  const cancel = useCallback(() => {
    if (flow) void invokeNative<void>("github_device_flow_cancel", { flowId: flow.flow_id });
    setFlow(null);
    setError(null);
  }, [flow]);

  return { authorized, resolved, flow, error, begin, cancel };
}
