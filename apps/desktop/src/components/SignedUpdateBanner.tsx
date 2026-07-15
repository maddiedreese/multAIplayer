import React from "react";
import type { UpdateInstallStatus } from "../hooks/useUpdateNotice";
import type { UpdateNotice } from "../lib/core/updateCheck";

export function releaseVerificationUrl(version: string) {
  const tag = `v${version}`;
  return `https://github.com/maddiedreese/multAIplayer/blob/${tag}/docs/reproducible-builds.md#verify-the-published-artifact`;
}

export function SignedUpdateBanner({
  notice,
  installStatus,
  onInstall
}: {
  notice: UpdateNotice;
  installStatus: UpdateInstallStatus;
  onInstall: () => void;
}) {
  const installing = installStatus === "installing";
  return (
    <div className="update-banner" role="status">
      <strong>Signed update available</strong>
      <span>
        {notice.currentVersion} &rarr; {notice.latestVersion}
        {notice.notes ? `: ${notice.notes}` : ""}
      </span>
      <span className="update-delivery-note">
        Installation is user-initiated; the pinned updater key verifies the download before installation.
      </span>
      {installStatus === "failed" ? <span>Update failed; use the verified release download.</span> : null}
      <a href={releaseVerificationUrl(notice.latestVersion)} target="_blank" rel="noreferrer">
        Verification details
      </a>
      <a href={notice.url} target="_blank" rel="noreferrer">
        Release notes
      </a>
      <button className="update-download" type="button" disabled={installing} onClick={onInstall}>
        {installing ? "Installing…" : "Install signed update"}
      </button>
    </div>
  );
}
