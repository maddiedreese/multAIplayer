# Product and architecture guide

This is a contributor map, not a security specification. The [threat model](threat-model.md) is the sole normative source for security claims, trust assumptions, audit status, and residual risks. Architecture decisions that must remain stable live in [ADRs](decisions/README.md).

## Product shape

multAIplayer is a macOS desktop room for trusted teammates working with one locally hosted Codex session. A room combines discussion, bounded project context, Codex activity, approvals, files and diffs, terminals, browser previews, Git/GitHub workflows, and explicit host handoff.

One member is the active host. That machine supplies the selected project, Codex process, local tools, credentials, and approval decisions. Other members may propose work and see the intentionally shared room projection; they do not receive a general remote-control channel. Hosting can move through an explicit, authenticated handoff rather than transparent failover.

The relay authenticates devices, authorizes membership, routes records, and retains bounded backlog. Room content is encrypted and decrypted in the native clients. Exact metadata exposure, retention, deletion, and compromised-participant boundaries belong in the threat model.

The alpha intentionally supports Apple-silicon macOS, GitHub identity, Codex app-server, one active project per room, and a single-node SQLite relay. Expansion to other platforms, identity providers, agents, or horizontally shared relay state requires a deliberate design decision.

## Repository map

| Path                                     | Owner                                                                |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `apps/desktop`                           | React presentation, application workflows, and Tauri desktop shell   |
| `apps/desktop/src-tauri`                 | Native capability boundary, local integrations, and secure storage   |
| `apps/desktop/src-tauri/crates/mls-core` | MLS lifecycle, invite cryptography, exporters, and encrypted state   |
| `apps/relay`                             | Authenticated HTTP/WebSocket routing, quotas, and SQLite persistence |
| `packages/protocol`                      | Shared wire records and runtime validation                           |
| `packages/git`, `packages/github`        | Host-side repository and GitHub adapters                             |
| `e2e`                                    | UI contracts and multi-process desktop journeys                      |
| `tools`                                  | Focused verification, release, and maintenance utilities             |
| `docs/decisions`                         | Normative architecture decision records                              |

Desktop code is organized into domain/platform helpers under `src/lib`, store-aware workflows under `src/application`, component-facing projections under `src/presentation`, and rendering under `src/components`. TypeScript, React Hooks linting, and workspace package boundaries are enforced automatically; code organization is reviewed where it affects clarity rather than duplicated in a hand-maintained dependency registry.

## Key flows

### Encrypted room event

1. A desktop action creates a typed room event.
2. The native MLS boundary encrypts it for the current epoch.
3. The relay validates the envelope and authorization, stores the opaque record, and broadcasts it.
4. Receiving native clients decrypt and validate it before the desktop projects it into state.

See [message lifecycles](message-lifecycles.md) for code entry points and [cryptography](cryptography.md) for mechanisms.

### Invitation

The host creates a capability-bearing HTTPS link whose secret payload is in the fragment. Native intake validates the origin and bounded fields, and admission uses the existing MLS join path. The website landing page removes the fragment from visible history and retains a valid retry only in memory. See the threat model for the precise trust and leakage boundaries.

### Privileged host action

A teammate request is projected for host review, then crosses a typed TypeScript adapter and the Rust IPC boundary. Rust validates inputs and current authority before invoking local Codex, terminal, filesystem, browser, Git, or GitHub capabilities. Text risk labels assist review; structured authorization and explicit approval enforce it. The [IPC audit](tauri-ipc-boundary-audit.md) inventories every registered command.

### Host handoff

Handoff is an authenticated state-machine transition. The current host prepares bounded continuity data, the intended successor accepts, and room authority changes only after the protocol completes. Live processes, unsaved application state, and credentials do not teleport; ordinary Git and backups remain the durable continuity mechanism.

### Encrypted local history

History hydration validates the current schema before enabling persistence and merges delayed relay activity with entity-specific monotonic rules. Canonical snapshots apply the same container bounds enforced by the loader, retain the newest entries, and are shared by ordinary saves and the all-eligible-room shutdown drain. Clear, forget, and membership-revocation cleanup serialize with pending writes; failed deletion replays the newest blocked snapshot, while rejoin remains gated until old MLS state is successfully removed.

## Where changes belong

- Put shared wire shapes and runtime guards in `packages/protocol`.
- Put cryptographic lifecycle behavior in `mls-core`, not React or relay routes.
- Put relay authorization beside the route or connection transition it governs.
- Put desktop orchestration in `application`, state/reducers in the owning store slice, pure rules in `lib`, and display projections in `presentation`.
- Expose native behavior through a narrow typed command and validate again in Rust.
- Record a durable, non-obvious architecture choice as an ADR instead of repeating it in guides.
- Update the threat model only when a security claim, assumption, or residual risk changes.

## Verification ladder

Use the narrowest relevant test while iterating, then run the repository gates before publishing:

```sh
npm run check
npm test
npm run verify
```

Pull requests run blocking workspace checks and an always-present product-journey aggregate; executable changes run UI, native two-client, and packaged macOS journeys. Scheduled workflows run focused fuzz, relay churn/restore, supply-chain, container, compatibility, and native checks. Releases verify signing, notarization, authenticated updater metadata, checksums, and the required asset set. [CONTRIBUTING.md](../CONTRIBUTING.md) owns the current workflow and check policy.

Generated evidence should be preferred over prose sentinels. A test that supports a threat-model claim emits a machine-readable claim record; CI then regenerates or verifies the evidence table. A green check must correspond to verification that actually executed.

The desktop production build also inventories emitted web assets and enforces a 7 MiB total / 3 MiB per-file budget. Monaco is loaded only when the file editor opens, with the languages and workers the product uses. Update the budget only after documenting an intentional product need; do not raise it merely to absorb an accidental dependency or eager import.

## Contributor walkthrough

A useful 15-minute review follows this route:

1. Read this map, the threat model summary, and the ADR index.
2. Trace one encrypted event through `packages/protocol`, `mls-core`, the relay, and desktop projection.
3. Trace one privileged command from its component through `application` and the typed native adapter to Rust authorization.
4. Inspect the focused tests beside each boundary and the composed journey in `e2e` or `apps/relay/test`.
5. Read the relevant ADR before changing a locked choice.
6. Run the focused workspace tests, then `npm run verify`.

The rule of thumb is simple: behavior belongs in the narrowest owning layer, validation belongs at every trust boundary, and end-to-end tests prove composition rather than replace focused tests.
