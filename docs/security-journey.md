# Deterministic security journey

The `security-journey` CI job runs the relay as a real child process and exercises the protocol-v2 delivery boundary with native-generated MLS fixtures. It covers device registration, KeyPackage publication and consumption, active-host Commit ordering, opaque MLS backlog delivery, removal, handoff, and plaintext scans of relay persistence artifacts.

The same gate scans every serialized wire artifact for the stable canary strings in `apps/desktop/test/fixtures/injection-red-team-v1.json`. Add a new versioned fixture when the corpus meaning changes; append cases without changing the version when only coverage expands.

The journey verifies that non-host and stale-epoch Commits fail closed and that relay SQLite, WAL, and SHM files do not contain application plaintext, private KeyPackage material, Welcome secrets, or exporter-derived values. CI publishes the JUnit result as the `security-journey-results` artifact.

Run it locally with:

```sh
npm run test:security-journey
```

The process journey needs Cargo because it builds the validator and generates its MLS fixture from the native core. When Cargo is not installed, the test exits successfully with the explicit result `skipped: Rust toolchain required`; this local convenience does not weaken CI, where the job installs pinned Rust 1.88.0 before running and a skipped result is unexpected. `MULTAIPLAYER_CARGO_BIN` may select a non-default Cargo executable.

## Desktop browser journeys

Playwright runs the actual web preview alongside an isolated, test-only UI-contract harness. The harness renders production React components and pure invite/Codex helpers, but it does not emulate Tauri or restore the retired browser cryptography. Every scenario lists its simulated boundaries in the page. Focused specs cover three user-facing authorization boundaries:

- `e2e/invite-join.spec.ts` keeps the guest composer locked through request creation and denial, and unlocks it only after explicit host approval;
- `e2e/host-handoff.spec.ts` keeps host and model controls with the outgoing host through offer and candidate request, then transfers them only after that host approves; and
- `e2e/codex-turn-approval.spec.ts` checks bounded context previews, member lockout, host approval and denial, input bounds, and execution-state transitions.

These browser cases are UI-contract evidence, not MLS, relay-confidentiality, native-authorization, or Codex app-server evidence. The process journey above remains the composition proof for native KeyPackage consumption, Welcome admission, host transfer, epoch exclusion, and relay persistence scanning. Run the complete browser suite with `npm run test:e2e`, or a single focused case such as `npm run test:e2e -- e2e/host-handoff.spec.ts`.

## Host execution limits

Native Codex turns use a validated 10–900 second timeout and bounded input. Codex JSON-RPC requests also have request deadlines. Terminal sessions are intentionally interactive rather than wall-clock limited, but retain at most 1,000 redacted output lines and bound an unterminated redaction buffer to 8 KiB; every initial command and later input requires a short-lived native authorization token. Local preview tunnels have a 20-second startup deadline, retain bounded startup logs, and terminate their child process when stopped or dropped. CI jobs and desktop test subprocesses have independent hard timeouts.
