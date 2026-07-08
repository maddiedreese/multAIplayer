import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import type { LocalPreviewDialogState } from "../types";

const cloudflaredInstallCommand = "brew install cloudflare/cloudflare/cloudflared";

export function LocalPreviewDialog({
  dialog,
  busy,
  disclaimer,
  safetyText,
  onClose,
  onSelectedUrlChange,
  onManualUrlChange,
  onBackToSelect,
  onContinue,
  onStartSharing
}: {
  dialog: LocalPreviewDialogState;
  busy: boolean;
  disclaimer: string;
  safetyText: string;
  onClose: () => void;
  onSelectedUrlChange: (url: string) => void;
  onManualUrlChange: (url: string) => void;
  onBackToSelect: () => void;
  onContinue: () => void;
  onStartSharing: () => void;
}) {
  const [installCommandCopied, setInstallCommandCopied] = useState(false);

  async function copyInstallCommand() {
    await navigator.clipboard?.writeText(cloudflaredInstallCommand);
    setInstallCommandCopied(true);
    window.setTimeout(() => setInstallCommandCopied(false), 1800);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal local-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="local-preview-title">
        <div className="modal-header">
          <div>
            <span>Cloudflare Quick Tunnel</span>
            <strong id="local-preview-title">Share Local Preview</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Share Local Preview"
            disabled={dialog.phase === "starting"}
          >
            <X size={16} />
          </button>
        </div>

        {dialog.phase === "select" && (
          <>
            <p className="modal-copy">{disclaimer}</p>
            {dialog.candidates.length > 0 && (
              <label className="field-stack">
                <span>Detected local servers</span>
                <select
                  value={dialog.selectedUrl}
                  onChange={(event) => onSelectedUrlChange(event.target.value)}
                >
                  {dialog.candidates.map((candidate) => (
                    <option key={candidate.url} value={candidate.url}>
                      {candidate.label} · {candidate.url}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field-stack">
              <span>Manual local URL</span>
              <input
                value={dialog.manualUrl}
                onChange={(event) => onManualUrlChange(event.target.value)}
                placeholder="http://localhost:3000"
              />
            </label>
            {dialog.error && <div className="workflow-message">{dialog.error}</div>}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={onContinue} disabled={busy}>
                Continue
              </button>
            </div>
          </>
        )}

        {dialog.phase === "install" && (
          <>
            <p className="modal-copy">
              cloudflared is required to start a Cloudflare Quick Tunnel on macOS. Install it with Homebrew, then come back here and check again.
            </p>
            <div className="install-helper">
              <pre className="install-snippet">{cloudflaredInstallCommand}</pre>
              <button type="button" className="ghost" onClick={() => void copyInstallCommand()}>
                {installCommandCopied ? <Check size={14} /> : <Copy size={14} />}
                {installCommandCopied ? "Copied" : "Copy command"}
              </button>
            </div>
            {dialog.error && <div className="workflow-message">{dialog.error}</div>}
            <div className="modal-actions">
              <button type="button" onClick={onBackToSelect}>
                Back
              </button>
              <button type="button" className="primary" onClick={onContinue}>
                Check again
              </button>
            </div>
          </>
        )}

        {(dialog.phase === "confirm" || dialog.phase === "starting") && (
          <>
            <div className="confirmation-copy">
              {safetyText.split("\n").map((line, index) => (
                line ? <p key={index}>{line}</p> : <br key={index} />
              ))}
            </div>
            <dl className="local-preview-summary">
              <div>
                <dt>Source</dt>
                <dd>{dialog.selectedUrl}</dd>
              </div>
              <div>
                <dt>cloudflared</dt>
                <dd>{dialog.cloudflaredVersion ?? "available"}</dd>
              </div>
            </dl>
            {dialog.error && <div className="workflow-message">{dialog.error}</div>}
            <div className="modal-actions">
              <button type="button" onClick={onBackToSelect} disabled={dialog.phase === "starting"}>
                Back
              </button>
              <button type="button" className="primary" onClick={onStartSharing} disabled={dialog.phase === "starting"}>
                {dialog.phase === "starting" ? "Starting..." : "Start sharing"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
