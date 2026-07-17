import type { GitHubDeviceStart } from "../lib/identity/authClient";

export interface GitHubRepositoryAccessPromptProps {
  signedIn: boolean;
  authorized: boolean;
  resolved: boolean;
  flow: GitHubDeviceStart | null;
  error: string | null;
  onAuthorize: () => void;
  onCancel: () => void;
}

export function GitHubRepositoryAccessPrompt(props: GitHubRepositoryAccessPromptProps) {
  if (!props.signedIn || props.authorized) return null;
  return (
    <div className="workflow-message">
      {props.flow ? (
        <>
          <div>
            Enter <code>{props.flow.user_code}</code> at <code>github.com/login/device</code> to authorize optional
            public and private repository workflows.
          </div>
          <button className="ghost" onClick={props.onCancel}>
            Cancel authorization
          </button>
        </>
      ) : (
        <>
          <div>
            Repository workflows are off by default. Authorize GitHub's <code>repo</code> scope only when you want
            pull-request or Actions access.
          </div>
          <button className="ghost" onClick={props.onAuthorize} disabled={!props.resolved}>
            Authorize repository access
          </button>
        </>
      )}
      {props.error && <div className="danger">{props.error}</div>}
    </div>
  );
}
