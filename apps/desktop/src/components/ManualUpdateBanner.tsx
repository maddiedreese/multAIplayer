import React from "react";
import type { UpdateNotice } from "../lib/core/updateCheck";

export function releaseVerificationUrl(version: string) {
  const tag = `v${version}`;
  return `https://github.com/maddiedreese/multAIplayer/blob/${tag}/docs/reproducible-builds.md#verify-the-published-artifact`;
}

/** Explicitly manual update delivery: metadata may notify, but only GitHub Releases distributes the app. */
export function ManualUpdateBanner({ notice }: { notice: UpdateNotice }) {
  return (
    <div className={`update-banner ${notice.security ? "security" : ""}`} role="status">
      <strong>{notice.security ? "Security update available" : "Update available"}</strong>
      <span>
        {notice.currentVersion} &rarr; {notice.latestVersion}
        {notice.notes ? `: ${notice.notes}` : ""}
      </span>
      <span className="update-delivery-note">Manual download; this app never installs updates automatically.</span>
      <a href={releaseVerificationUrl(notice.latestVersion)} target="_blank" rel="noreferrer">
        Verify with Sigstore
      </a>
      <a className="update-download" href={notice.url} target="_blank" rel="noreferrer">
        Open GitHub Release
      </a>
    </div>
  );
}
