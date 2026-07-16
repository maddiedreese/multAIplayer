import { BookOpen, CheckCircle2, RotateCcw } from "lucide-react";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "../lib/core/productLinks";

export function HelpDrawerPanel({
  completedSteps,
  totalSteps,
  onOpenSetupGuide,
  onShowSetupChecklist,
  onRestartSetupGuide
}: {
  completedSteps: number;
  totalSteps: number;
  onOpenSetupGuide: () => void;
  onShowSetupChecklist: () => void;
  onRestartSetupGuide: () => void;
}) {
  return (
    <div className="drawer-content help-drawer-panel">
      <section className="drawer-section">
        <div className="panel-title">
          <div>
            <strong>Setup guide</strong>
            <small>
              {completedSteps} of {totalSteps} setup tasks complete
            </small>
          </div>
          <BookOpen size={18} aria-hidden="true" />
        </div>
        <p>
          Reopen the device checks, create-or-join guidance, and safety summary at any time. Setup progress stays only
          on this device.
        </p>
        <button className="primary-wide" type="button" onClick={onOpenSetupGuide}>
          <BookOpen size={15} aria-hidden="true" />
          Open setup guide
        </button>
        <button className="ghost-wide" type="button" onClick={onShowSetupChecklist}>
          <CheckCircle2 size={15} aria-hidden="true" />
          Show setup checklist
        </button>
        <button className="ghost-wide" type="button" onClick={onRestartSetupGuide}>
          <RotateCcw size={15} aria-hidden="true" />
          Restart setup guide
        </button>
      </section>

      <section className="drawer-section">
        <strong>Accounts work differently</strong>
        <p>
          GitHub identity is used for workspace membership. The same alpha sign-in separately requests the broad
          <code>repo</code> permission for optional pull-request and Actions API workflows, including private
          repositories. ChatGPT authorizes the local Codex process. These are separate authority domains.
        </p>
      </section>

      <section className="drawer-section">
        <strong>Privacy during setup</strong>
        <p>
          The guide does not store invite links, project paths, prompts, account details, or project content. It keeps
          only bounded progress flags and workspace identifiers on this device.
        </p>
      </section>

      <section className="drawer-section">
        <strong>Policies and support</strong>
        <p>
          multAIplayer is a free, open-source alpha provided without guaranteed support or continued hosted service.
        </p>
        <p>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener">
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noreferrer noopener">
            Terms of Service
          </a>
        </p>
      </section>
    </div>
  );
}
