# Alpha Release Readiness

This checklist is for a public or wider private alpha. It separates work the repo can verify from work that requires maintainer accounts, infrastructure, signing, or live user testing.

## Automated Gates

Run before opening a release candidate PR, tagging, or publishing artifacts:

```bash
npm run release:preflight
```

For an internet-facing relay, run this in the production relay environment:

```bash
npm run doctor:production-relay
```

Expected automated coverage:

- TypeScript and package builds.
- Desktop, relay, protocol, crypto, Git, and GitHub unit tests.
- Native Tauri/Rust tests.
- Rust formatting.
- Production web build.
- Local setup checks for Node, npm, Rust, Cargo, lockfiles, env templates, and macOS packaging tools.
- Hosted relay sanity checks for GitHub OAuth, session secret strength, exact HTTP(S) allowed origins, auth-required mode, disabled debug endpoints, disabled demo seeding, enabled rate limits, persistent data path, and conservative proxy-header handling.
- An alpha smoke test that covers room creation, encrypted local history, chat attachments, Codex approval context, file/diff preview selection, terminal approval, GitHub PR/Actions readiness, browser gating, usage-limit host handoff context, and locked-room blocking.

## Manual Maintainer Work

These require a maintainer account, secret, device, or product decision:

- Register and configure the official GitHub OAuth app.
- Choose the official hosted relay provider and deploy it behind HTTPS/WSS.
- Configure `multAIplayer.com` and final callback/origin values.
- Create and store production relay secrets.
- Set up Apple Developer ID signing and notarization.
- Decide release cadence, support expectations, and disclosure contact.
- Run a real multi-user test with at least two GitHub accounts and two machines.
- Review final security/trust copy before public announcement.

## Required Dogfood Scenarios

Before a wider alpha, manually run these in the native macOS app:

- Sign in with GitHub and join a room through an invite link.
- Send encrypted chat messages and attachments.
- Select a local project folder and open files/diffs from the inspector.
- Invoke Codex from chat and approve a turn as active host.
- Open the in-app browser from the browser tab and from a Codex instruction such as `@Codex open localhost`.
- Open the terminal tab, type into the auto-created shell, create a second terminal, stop/restart a terminal, and copy terminal Markdown.
- Create a branch, commit, push, open a draft PR, and refresh GitHub Actions.
- Trigger or simulate Codex usage exhaustion and accept host handoff on another device.
- Forget a room locally and confirm locked-room controls stay blocked.
- Remove a team member and confirm relay access is revoked for future room traffic.
- Review [alpha-limitations.md](alpha-limitations.md) and repeat private-repo/browser/terminal limitations in release notes.

## Alpha-Only Limitations To Keep Visible

- Builds are unsigned and not notarized until Apple Developer ID setup is complete.
- Production-grade cryptographic member removal still needs key epochs and per-device key delivery.
- The JSON relay store is acceptable for alpha/self-hosting but should become database-backed before production claims.
- Rate limiting is process-local; multi-instance hosting needs an edge or shared-store limiter.
- The browser and terminal expose host-local capabilities after approval and need continued security review.
- Codex continuity uses local app-server behavior and reconstructed room context; it should be tested against real Codex failures before relying on it during important work.
