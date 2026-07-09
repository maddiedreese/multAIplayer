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

Use [official-relay-deployment-checklist.md](official-relay-deployment-checklist.md) for the hosted relay launch checklist and [public-alpha-maintainer-guide.md](public-alpha-maintainer-guide.md) for maintainer-owned setup work.

Expected automated coverage:

- TypeScript and package builds.
- Desktop, relay, protocol, crypto, Git, and GitHub unit tests.
- Native Tauri/Rust tests.
- Rust formatting.
- Production web build.
- Local setup checks for Node, npm, Rust, Cargo, lockfiles, env templates, and macOS packaging tools.
- Project package license consistency and dependency license scanning.
- SQLite relay backup/restore drill in fixture mode.
- Hosted relay sanity checks for GitHub OAuth, session secret strength, exact HTTP(S) allowed origins, auth-required mode, disabled debug endpoints, disabled demo seeding, enabled rate limits, persistent data path, and conservative proxy-header handling.
- An alpha smoke test that covers room creation, encrypted local history, chat attachments, Codex approval context, file/diff preview selection, terminal approval, GitHub PR/Actions readiness, browser gating, usage-limit host handoff context, and locked-room blocking.

## Manual Maintainer Work

These require a maintainer account, secret, device, or product decision:

- Register and configure the official GitHub OAuth app.
- Choose the official hosted relay provider and deploy it behind HTTPS/WSS.
- Configure `multAIplayer.com` and final callback/origin values.
- Create and store production relay secrets.
- Set up Apple Developer ID signing and notarization secrets.
- During dogfooding/release setup, set `VITE_RELAY_HTTP_URL` and `VITE_RELAY_URL` for hosted-relay-first desktop builds once the official relay URLs are final.
- Decide release cadence, support expectations, and disclosure contact.
- Publish or update the alpha update manifest at `https://multaiplayer.com/releases/latest.json`.
- Run `node scripts/sqlite-backup-restore-drill.mjs --data-path=/path/to/relay-store.sqlite` against a staged copy of the real relay SQLite store.
- Run a real multi-user test with at least two GitHub accounts and two machines.
- Review final security/trust copy before public announcement.
- Confirm ordinary native-app bug reports ask users to save diagnostics from Account settings and review the bundle before attaching it; the memory-only web preview may copy its current-session bundle.
- Confirm native diagnostics use the platform app log directory with `0600` file permissions, seven-day/256 KiB/500-entry bounds, corruption-tolerant parsing, and capture-time plus export-time redaction.
- Confirm the web preview remains memory-only, native Rust writes exports without returning stored entries or bundle contents to JavaScript, and review guidance prohibits logging payload objects in place of stable error codes and bounded ids.

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

- Public macOS alpha artifacts are Developer ID signed and notarized. Local development builds are not release artifacts and may be unsigned.
- The alpha app checks a hosted release manifest and shows an in-app update banner, but users still manually download and install updated builds.
- Production-grade cryptographic member removal still needs key epochs and per-device key delivery.
- JSON relay storage is for local/dev self-hosting. Hosted or internet-facing alpha relays should use SQLite and still need backup/restore drills before production claims.
- Rate limiting is process-local; multi-instance hosting needs an edge or shared-store limiter.
- The browser and terminal expose host-local capabilities after approval and need continued security review.
- Codex continuity uses local app-server behavior and reconstructed room context; it should be tested against real Codex failures before relying on it during important work.
