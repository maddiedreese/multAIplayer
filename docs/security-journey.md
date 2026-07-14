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

`e2e/native-shell/journey.ts` launches two Tauri application binaries with isolated Linux homes, XDG directories, and Secret Service stores. WebKitWebDriver controls the actual host and guest windows. Through production UI and Tauri commands, the host creates a room; a host denial leaves the guest without MLS group state; an expired capability is rejected before a request reaches the host; and a fresh requesting app is killed with `SIGKILL` after the native SQLCipher transaction persists its exact request but before host approval. On restart, the same profile and Secret Service store recover the request, expose only relay-visible replay material and routing metadata to the webview, and keep the bearer capability inside Rust. The host creates the membership Commit while the guest is offline. A loopback harness gate observes the subsequent Welcome request only after the relay has accepted that Commit, stops the real relay, starts a new process over the same SQLite store, verifies the accepted epoch survived, and only then releases Welcome delivery. Because relay device sessions are deliberately process-local, the desktop re-proves its device identity after the replacement relay rejects the stale session. The retry reuses and validates the durable approval outbox instead of generating a second Commit. The replacement relay stores the Welcome, after which the restarted guest republishes the byte-identical request if necessary, accepts the response through the authoritative native-stored binding, restores the exact device-bound roster, and proves usable epoch keys by decrypting the next message. This proves Commit/epoch and authenticated-client recovery across relay restart followed by Welcome durability across guest restart; it does not claim that the Welcome was stored before the relay restart. The journey then transfers authority, checks the relay's active host, and sends successor traffic. A diagnostic step calls the production MLS and workspace client modules inside the native guest shell to prove the real validator rejects a tampered native KeyPackage and to distinguish an absent native group from a merely locked UI.

The job uses real relay processes, SQLite persistence, WebSocket transport, `mls-keypackage-validator`, native MLS/HPKE processing, and application credential storage. The restart proxy only preserves the client-visible loopback address and deterministically gates one request; it does not synthesize a relay response, Commit, Welcome, reconnect, or persisted state. Relay debug authentication is the one intentional mock. The expiry scenario also uses an explicitly enabled, loopback-only debug time-control to backdate the real relay invite; the production invite lookup and pruning paths perform the rejection, and the test verifies no KeyPackage was durably published. The two fixture identities begin as team members, so “invite” in this test means device MLS admission to the encrypted room and not GitHub OAuth or team-membership invitation. Linux is used because the pinned `tauri-driver` supports WebKitWebDriver there but does not implement macOS automation. The macOS job separately runs the native-core/relay composition journey before packaging; it does not claim WKWebView UI coverage.

Every native-shell invocation that reaches normal process teardown writes `reports/native-shell-e2e/duration.json` with monotonic total and per-stage durations, including ordinary assertion failures. CI retains that artifact for 30 days, renders the timing table in the job summary, and emits a post-run warning above the six-minute journey budget. A cancellation or hard runner timeout can prevent teardown; the artifact upload then fails visibly instead of silently claiming timing evidence. On successful journeys, `scripts/check-native-journey-duration.mjs` is a blocking regression tripwire: it requires the reviewed stage sequence, enforces the per-stage ceilings declared beside the metrics code, and rejects a total over eight minutes. The warning provides headroom before the hard policy; neither replaces the job's 30-minute recovery timeout.

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
