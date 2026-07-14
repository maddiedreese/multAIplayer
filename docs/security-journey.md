# Security journeys

The repository keeps three composition levels separate:

1. Chromium UI-contract specs render production components but visibly simulate relay, MLS, persistence, and native execution.
2. A stateful process test connects two independent live `mls-core` clients to a real relay and validator.
3. A Linux native-shell job drives two isolated real Tauri processes through the production desktop, Tauri command, MLS, relay, validator, SQLite, and credential-store paths.

The native-shell journey's only mocked external boundary is GitHub identity establishment: it calls the relay's test-only debug-auth endpoint instead of GitHub OAuth. Both GitHub users are already members of the fixture team. The test covers admission of the guest device into the MLS group through the real KeyPackage, HPKE request, host approval, Add Commit, and Welcome flow; it does not cover GitHub OAuth or inviting a GitHub user to a team.

## Deterministic relay confidentiality journey

The `security-journey` CI job runs the relay as a real child process and exercises the protocol-v2 delivery boundary with native-generated MLS fixtures. It covers device registration, KeyPackage publication and consumption, active-host Commit ordering, opaque MLS backlog delivery, removal, handoff, and plaintext scans of relay persistence artifacts. The native artifacts are generated before relay delivery, so this test is not evidence that two desktop processes react correctly to live relay events.

The same gate scans every serialized wire artifact for the stable canary strings in `apps/desktop/test/fixtures/injection-red-team-v1.json`. Add a new versioned fixture when the corpus meaning changes; append cases without changing the version when only coverage expands.

The journey verifies that non-host and stale-epoch Commits fail closed and that relay SQLite, WAL, and SHM files do not contain application plaintext, private KeyPackage material, Welcome secrets, or exporter-derived values. CI publishes the JUnit result as the `security-journey-results` artifact.

Run it locally with:

```sh
npm run test:security-journey
```

The process journey needs Cargo because it builds the validator and generates its MLS fixture from the native core. When Cargo is not installed, the test exits successfully with the explicit result `skipped: Rust toolchain required`; this local convenience does not weaken CI, where the job installs pinned Rust 1.88.0 before running and a skipped result is unexpected. `MULTAIPLAYER_CARGO_BIN` may select a non-default Cargo executable.

## Stateful native-core and relay journey

`apps/relay/test/live-native-relay-journey.test.ts` starts two separate, long-lived `mls-integration-client` processes. Each owns a distinct real `MlsEngine` and device signer. The test uploads the guest's real KeyPackage through the actual validator, publishes MLS bytes through a real relay and SQLite store, and passes the relay-delivered bytes—not a side-channel copy—into the receiving engine. It checks application decryption, signed host handoff, rejection of a former host's next Commit attempt, and post-handoff successor traffic.

This fixture intentionally exposes only direct `mls-core` operations. Its state is ephemeral, and it does not call Tauri commands, use Keychain-backed admission receipts, or exercise the desktop UI. It is sequencing and process-composition evidence, not production invite-command or durable-state evidence. It runs in both the ordinary relay suite and the focused `security-journey` gate.

## Two real Tauri shells

`e2e/native-shell/journey.ts` launches two Tauri application binaries with isolated Linux homes, XDG directories, and Secret Service stores. WebKitWebDriver controls the actual host and guest windows. Through production UI and Tauri commands, the host creates a room; a host denial leaves the guest without MLS group state; an expired capability is rejected before a request reaches the host; a fresh request is approved and its real Welcome processed; the peers exchange an encrypted message; and authority transfers before the successor sends another message. A diagnostic step calls the production MLS and workspace client modules inside the native guest shell to prove the real validator rejects a tampered native KeyPackage and to distinguish an absent native group from a merely locked UI. The test also checks the relay's recorded active host.

The job uses the real relay process, SQLite persistence, WebSocket transport, `mls-keypackage-validator`, native MLS/HPKE processing, and application credential storage. Relay debug authentication is the one intentional mock. The expiry scenario also uses an explicitly enabled, loopback-only debug time-control to backdate the real relay invite; the production invite lookup and pruning paths perform the rejection, and the test verifies no KeyPackage was durably published. The two fixture identities begin as team members, so “invite” in this test means device MLS admission to the encrypted room and not GitHub OAuth or team-membership invitation. Linux is used because the pinned `tauri-driver` supports WebKitWebDriver there but does not implement macOS automation. The macOS job separately runs the native-core/relay composition journey before packaging; it does not claim WKWebView UI coverage.

Every native-shell invocation that reaches normal process teardown writes `reports/native-shell-e2e/duration.json` with monotonic total and per-stage durations, including ordinary assertion failures. CI retains that artifact for 30 days, renders the timing table in the job summary, and emits a post-run warning above the six-minute journey budget. A cancellation or hard runner timeout can prevent teardown; the artifact upload then fails visibly instead of silently claiming timing evidence. The budget is an early regression signal rather than a substitute for the job's hard timeout or a correctness gate.

Run it in a matching Linux environment with:

```sh
xvfb-run -a npm run test:e2e:native
```

## Desktop browser journeys

Playwright runs the actual web preview alongside an isolated, test-only UI-contract harness. The harness renders production React components and pure invite/Codex helpers, but it does not emulate Tauri or restore the retired browser cryptography. Every scenario lists its simulated boundaries in the page. Focused specs cover three user-facing authorization boundaries:

- `e2e/invite-join.spec.ts` keeps the guest composer locked through request creation and denial, and unlocks it only after explicit host approval;
- `e2e/host-handoff.spec.ts` keeps host and model controls with the outgoing host through offer and candidate request, then transfers them only after that host approves; and
- `e2e/codex-turn-approval.spec.ts` checks bounded context previews, member lockout, host approval and denial, input bounds, and execution-state transitions.

These browser cases are UI-contract evidence, not MLS, relay-confidentiality, native-authorization, or Codex app-server evidence. The stateful process and two-shell journeys above provide their separately stated native/relay evidence; the deterministic process journey retains relay persistence scanning and removed-member exclusion. Run the complete browser suite with `npm run test:e2e`, or a single focused case such as `npm run test:e2e -- e2e/host-handoff.spec.ts`.

## Host execution limits

Native Codex turns use a validated 10–900 second timeout and bounded input. Codex JSON-RPC requests also have request deadlines. Terminal sessions are intentionally interactive rather than wall-clock limited, but retain at most 1,000 redacted output lines and bound an unterminated redaction buffer to 8 KiB; every initial command and later input requires a short-lived native authorization token. Local preview tunnels have a 20-second startup deadline, retain bounded startup logs, and terminate their child process when stopped or dropped. CI jobs and desktop test subprocesses have independent hard timeouts.
