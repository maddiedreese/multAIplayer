# Architecture walkthrough

This is the durable script for a 20-minute contributor walkthrough. A maintainer can record it with any screen recorder; the repository remains the source of truth, while the recording gives first-time contributors a human route through it.

## Recording recipe

1. Check out a clean `main`, run `npm ci`, and open the repository root in an editor.
2. Record at 1080p with the editor text at a readable size. Do not open `.env`, logs, local databases, private repositories, or signed-in browser content.
3. Follow the chapters below and show the named files. Keep the terminal visible only for the listed safe commands.
4. Turn on captions, export an MP4, and publish it somewhere maintainers can replace without changing repository history.
5. If a recording is published, add its URL and date below. Re-record when the architecture or contributor commands materially change; small file moves only require updating this script.

Recording: _not published yet_. The script is complete and can be followed without a video.

## 0:00 — Product and trust boundary

Open `docs/product-architecture.md`, then `docs/threat-model.md`. Explain that the relay transports encrypted room records and metadata, while project files, Codex, terminals, Git, and browser capabilities stay on the active host. The client and host boundaries—not the relay—are where plaintext exists.

## 3:00 — Repository map

Show the root workspaces:

- `packages/protocol`: shared records and runtime guards;
- `apps/desktop/src-tauri/crates/mls-core`: MLS lifecycle orchestration in `engine.rs` and its focused child modules, automatic staged-write cleanup and encrypted persistence in `storage.rs` and `storage/`, invite-v3 authentication, HPKE sealing, credentials, and exporter use;
- `packages/codex`, `packages/git`, and `packages/github`: host-side adapters;
- `apps/relay`: HTTP/WebSocket transport, authorization, persistence, and limits;
- `apps/desktop`: React state/UI plus the Tauri Rust boundary;
- `e2e`: deployed desktop journeys; and
- `scripts`: repository policy and verification gates.

Point out that imports are intentionally directional and `scripts/eslint-boundaries.test.mjs` guards those boundaries.
For the native boundary, also show `apps/desktop/src-tauri/src/mls_native.rs`: its identity, crypto, history, group-command, store-support, `types`, and `invites` child modules preserve one Tauri command API while keeping responsibilities independently reviewable. Reviewability comes from domain splits and semantic tests rather than a physical-line threshold.

Before moving on, trace one invitation transport without exposing a real link. Start at `inviteLinkActions.ts`, where the app creates an HTTPS `open.multaiplayer.com/invite` URL whose entire payload is a fragment. Then show `invite_link.rs` and `nativeInviteIntake.ts`: macOS associated-domain delivery is parsed again in Rust, retained in one one-shot memory slot, announced by a content-free event, and delegated to the existing MLS join action. Contrast that with the website landing, which scrubs the fragment before hydration and uses an in-memory cross-host retry rather than storage or a custom scheme. Finally show `trusted_auth.rs` and `authExternalUrl.ts` as the independent Rust/TypeScript validation pair for opening GitHub or ChatGPT in the system browser.

## 6:00 — One encrypted message

Follow `docs/message-lifecycles.md` from a desktop intent through Rust MLS encryption, opaque relay persistence/broadcast, and Rust MLS decryption. Show that the relay stores an opaque MLS message rather than chat plaintext. Mention that group cryptography belongs in the Rust MLS core, not React components or relay handlers.

## 9:00 — One privileged host action

Use `docs/codex-hosting.md` to trace a Codex request. Show the approval UI in the desktop, the TypeScript command adapter, and the Rust authorization boundary. Emphasize that command text classification is review assistance; structured permissions and explicit user approval are the enforcing controls.

## 12:00 — State and UI boundaries

Open the desktop store modules and one component test. Then show the three desktop code layers:

- `apps/desktop/src/lib/<domain>` contains pure domain and platform modules; direct files at the `lib` root are forbidden;
- `apps/desktop/src/application/<domain>` owns store-aware workflows and use cases; and
- `apps/desktop/src/presentation/<domain>` owns component-facing projections and view models.

Components render state and dispatch actions, while protocol, crypto, transport, and native capabilities remain behind adapters. The ESLint desktop-architecture rules enforce the layer boundaries and the measured acyclic dependency matrix between `lib` domains. New contributors should extend the narrowest existing domain rather than add a flat helper or cross-cutting import.

## 15:00 — Verification ladder

Run:

```bash
npm run test:scripts
npm run test -w @multaiplayer/desktop
```

Explain the progression from focused tests to `npm run verify:web`, `npm run verify:native`, and finally `npm run verify`. Point to `docs/ci-policy.md` for which GitHub jobs block merges and which scheduled security jobs should be investigated separately.

## 18:00 — First contribution

Open `.github/good-first-issues/`, choose one of the linked live tickets, and show `CONTRIBUTING.md`. Explain DCO sign-off, the branch/PR workflow, and why a focused first PR should avoid unrelated formatting or security-policy changes.

Finish with this rule of thumb: put behavior in the narrowest owning layer, test it there, and use integration or end-to-end coverage only to prove the layers compose.
