# multAIplayer Product And Architecture Spec

Status: initial planning doc  
License: Apache-2.0  
Primary platform: macOS first  
Desktop stack: Tauri  
Repository: monorepo at `github.com/maddiedreese/multAIplayer`  
Public posture: honest alpha

## 1. Product Thesis

multAIplayer is a private group chat app where your team can bring Codex into the conversation.

People chat normally in rooms. When the group needs help, someone invokes Codex with a button or `@Codex`. The active Codex host approves the turn, and their local Codex works from the chat since the last Codex response, included attachments, the selected local project folder, browser state, and terminal context. Codex can make code changes, run commands, commit, push, and open a PR while the room watches together.

The core promise:

> multAIplayer does not store plaintext transcripts or hold AI credentials.

The short public pitch:

> Group chat for coding with Codex. Private by default. Open source.

## 2. Non-Goals

- Do not use OpenAI Platform API billing for the main Codex experience.
- Do not collect, proxy, or store Codex access tokens.
- Do not provide a browser-only version that spends ChatGPT or Codex subscription limits.
- Do not override Codex with a custom system prompt.
- Do not support general whole-desktop computer use in v1.
- Do not persist plaintext chat transcripts on the relay.
- Do not support multiple active projects in one room in v1.

## 3. Product Model

### Teams

A team/group is the top-level collaboration layer.

Teams can contain many project rooms. Membership is invite-based, with an optional approval gate for team admins.

Owners can promote members, demote admins, remove non-owner members, and transfer ownership to another team member. Ownership transfer is explicit and leaves a single owner; the previous owner becomes an admin.

Removing a member immediately closes that user's live relay sockets for the team and invalidates outstanding team invite metadata, so re-entry requires a fresh invite. This is relay-level access revocation, not retroactive cryptographic erasure of room keys or content already received.

Team-level settings include:

- members and roles;
- default history retention;
- default approval policy;
- default Codex model;
- default browser policy;
- default invite policy;
- official relay or self-hosted relay connection.

### Rooms

A room is a chat space associated with one active project at a time.

Rooms are spawned from teams and usually correspond to a project/local folder. A room has many human members and at most one active Codex host at a time.

Room-level settings include:

- active project folder;
- active Codex host;
- selected Codex model;
- host approval policy;
- history retention;
- browser profile persistence;
- terminal list;
- invite links;
- visibility/secrets warning acknowledgement.

The active project folder is a host-local path. The macOS app can attach it with a native folder picker or a pasted path. The relay stores the path as room metadata so members understand what project a room is about, but it never receives file contents. File reads, diffs, terminal commands, Git operations, and Codex turns execute from the active host's local desktop app after host approval.

Native project file access is confined to the selected project root and rejects parent-directory or symlink escapes. File previews are read with a byte cap, and native diff output is bounded to 200,000 characters with an explicit truncation marker so generated files or large diffs do not overwhelm the desktop UI or copied context.

Project file search, file preview, Git status, diff reads, Git remote inference, and approved Git workflows are local workspace actions. They are available only when workspace mode is enabled and the current device is the active host for the room. Other members can still see room-shared encrypted chat, attachments, browser decisions, Codex/Git events, and copied/shared outputs, but their clients do not independently read the host's local project path.

Desktop git-status summaries are scoped per room/project. Switching rooms clears the visible status for the incoming room until its own local `git status` read completes, so changed-file counts, PR drafts, and diff summaries do not reuse another room's project state.

The relay bounds metadata before storage and broadcast: team names, room names, WebSocket user/device identities, device ids, display names, live presence labels, host labels, avatar URLs, public key fingerprints, public key JWK blobs, project paths, and model ids all have explicit length limits and reject control characters where human-visible text is expected. Project paths are non-empty strings up to 2,048 characters, and model ids are known ids or model-like ids up to 80 characters.

The desktop client mirrors those bounds before creating teams/rooms, changing project paths or model ids, and accepting host handoff settings, so most invalid metadata is caught locally before it reaches the relay.

When the active host changes approval policy, room mode, Codex model, project path, browser allowlist, or browser profile persistence, the relay metadata updates for routing/sidebar freshness and the desktop also sends an encrypted `room.settings` activity event. Room members see a system transcript message after local decryption, while the relay cannot read the human-readable before/after activity text.

### Active Codex Host

The active host is the user whose local desktop app talks to Codex app-server for a given room.

Only one Codex host is active per room. Hosting can be handed off. When hosting is handed off, the new host receives the room context needed to continue: encrypted local chat history, attachments, room metadata, and project association. After decrypting locally, the new host can approve Codex turns against the full available room context.

The alpha sends host handoff packages as encrypted `room.host` events. They summarize the project path, selected model, approval policy, recent-message count, attachment names, and terminal names so a new host can understand what they are inheriting before claiming the room. Accepting a handoff sends a second encrypted `room.host` acceptance event so the room roster stops presenting that handoff as available.

If the active host disconnects, the room remains available for human chat but becomes Codex-inactive until another member hosts.

## 4. Core User Flows

### Human Chat

Users chat normally in a room. Messages, reactions, attachments, and references are end-to-end encrypted before they reach the relay.

Invite approval requests are encrypted room events. A gated invite imports room metadata but not the room key, then sends a device-sealed join request encrypted to the active host device public key. If the host approves, the approval event is device-sealed to the requester and includes the room key wrapped to the requester device public key. The alpha treats this as an approval workflow and visibility boundary, not as full cryptographic member removal; production-grade gated membership still needs key rotation after removal.

Active hosts can rotate a room key for future messages and invite links. The rotation is published as an encrypted room event using the current room key, then clients that can decrypt that event replace their local room key and clear stale encrypted local-history ciphertext before future saves use the new key. This is useful after accidental direct-invite sharing or routine hygiene, but it is not full member removal in the alpha: any device that still has the old room key and can receive the rotation event can learn the new key. Strong removal still requires relay membership enforcement, key rotation that excludes removed devices, and recovery semantics; the alpha enforces relay membership removal and stale-invite revocation, but key exclusion remains future work.

If a room is forgotten on the device or relay membership is revoked, the desktop treats it as locally locked. While locked, the app blocks chat sends and reactions, host claiming, host handoff acceptance, invite generation, invite approval decisions, terminal request decisions, room-key rotation, and host-controlled room settings such as model, approval policy, room modes, project folder, and browser policy until the room is unlocked with a fresh invite or key.

The alpha embeds small text/code attachment previews directly in encrypted chat payloads: up to 5 files per message, 80 KB per file, and 200 KB total preview content per message. Larger previews are encrypted locally, uploaded to relay blob storage as ciphertext, referenced from the encrypted chat message by blob id, and decrypted locally into the file preview pane when a room member opens them. Serialized encrypted room envelopes are also bounded by the relay before WebSocket fanout and backlog storage, so large file previews must use encrypted blob storage rather than oversized room events.

Codex approval distinguishes inline attachment content from encrypted blob references. Inline text previews are included in the Codex turn package after host approval. Encrypted blob attachments are listed by name and blob reference only in the alpha Codex turn package, so approving a turn does not silently decrypt and inject large files into Codex context.

Composer text and attachment drafts are scoped per room. If a user switches rooms, unfinished message text stays with its original room. If a large encrypted attachment blob finishes uploading after a switch, the finished attachment remains queued only for the room where the upload began.

Project file previews and encrypted attachment blob opens are also tied to the originating room. If a room switch happens while a file read or blob decrypt is in flight, the completed read is ignored rather than rendered into the newly selected room's inspector. Attachment previews are blocked while a room is locally locked after forget or relay membership revocation.

The app keeps encrypted local history with a default retention window of 30 days. Retention is configurable per room, and each team can define the default retention policy inherited by newly created rooms. The local encrypted room payload includes chat messages plus host-side workflow records such as terminal requests, terminal snapshots, browser approvals, Codex events, Git workflow events, GitHub Actions refreshes, and host handoff packages.

### Invoke Codex

Codex can be invoked by:

- clicking an invoke button;
- mentioning `@Codex`.

On invocation, multAIplayer builds a turn package containing:

- chat messages since the last Codex response;
- attachments since the last Codex response;
- relevant room metadata;
- active project path and a bounded git-status summary;
- selected terminal context where useful;
- isolated browser state where enabled.

Attachments are included by default. Before the turn starts, the active host sees an approval sheet showing exactly what Codex will receive.

Codex turn execution is an active-host local workspace action in the macOS alpha. The approval summary includes project path, Git status, and terminal names only when workspace mode is enabled, the room is unlocked, and the current device is the active host for that room. Stale approval sheets are rechecked at approval time before the app calls the local Codex app-server.

Example approval summary:

```text
Codex will receive:
- 18 messages since the last Codex response
- 2 images
- 1 file: app.tsx
- Large file: large.log as encrypted blob reference only
- Workspace: /Users/maddie/dev/example
- Model: GPT-5.4
- Browser access: github.com only
- Terminals: dev-server, tests
```

The host can approve, deny, or adjust included context where supported.

### Host Approval Policies

Initial room approval presets:

- Ask every Codex turn.
- Auto-approve chat-only turns.
- Auto-approve browser on allowed sites.
- Never host this room.

Approval policies are host-side. They do not grant other users access to the host's Codex credentials, project files, browser state, or shell.

In the alpha, Auto-approve chat-only turns is intentionally narrow: it only runs automatically when the active host is invoking Codex and the turn package contains no attachments, no workspace path, no approved browser URLs, and no terminal context. Any host-side context falls back to the approval sheet.

### Terminal Requests

Rooms have persistent named terminals per project room, such as:

- `dev-server`;
- `tests`;
- `logs`;
- `shell`.

Non-host members can request terminal commands. These are separate from Codex command proposals:

- Human command request: a member proposes an exact command for the host to approve.
- Codex command proposal: Codex proposes or runs commands according to the active sandbox and approval policy.

Human command requests are encrypted room events. The relay can route the request but cannot read the command. The active host sees the requester and command before approving or denying it locally. Approved non-host terminal requests always execute from the active room's selected project folder on the host machine; the host app does not trust a requester-provided working directory.

Codex can spin up background or foreground terminals. A background terminal can be brought to the foreground by request or by host action.

Live terminal listing, terminal start/restart/stop, terminal input, ad hoc host checks, and approved command execution are active-host local workspace actions. Non-host members can request terminal commands when the room is unlocked and workspace mode is enabled, but their clients do not list or control the active host's local terminal processes.

The macOS alpha bounds approved one-shot terminal commands, persistent terminal launch commands, and interactive terminal input to 4,000 characters each, caps one-shot command output at 120,000 characters with an explicit truncation marker, and keeps the latest 1,000 output lines per terminal session in memory. Terminal snapshots are saved in encrypted local room history as stopped/restartable sessions, so a room can remember its named terminal roster and recent output after reload without claiming the underlying OS process survived. The desktop room activity feed for terminal, Codex, Git, and Actions events is also scoped per room and capped to the latest 1,000 lines per room.

### Browser Requests

Browser mode is room-scoped. Members request specific URLs with a short reason, and those requests are routed as encrypted room events. The host approves or denies each URL before it appears in the Codex turn context. Auto-approval for allowed browser sites is evaluated against the request's room, host, approval policy, and origin allowlist, never against whichever room happens to be selected in the app.

Browser access requests require an unlocked browser-enabled room. Browser approvals, denials, isolated browser opens, and browser profile resets require the current device to be the active host for that unlocked browser-enabled room.

The relay can see that a `browser.request` or `browser.event` envelope exists, but not the requested URL, reason, or decision details. Browser approval and denial decisions render as local system transcript messages after decryption, so room members can see the host-side browser audit trail without exposing it to the relay. Approved URLs can be opened in a room/project-scoped Tauri WebView window on the host machine. Browser profile persistence is a host-controlled room setting: profiles persist by default, hosts can reset them manually, and refresh mode closes and clears the room/project browser profile before each approved open. The alpha keeps this as an explicit host action; deeper browser automation can be added behind the same approval boundary.

Auto-approve browser on allowed sites is intentionally conservative. It only applies for the active host, only when the URL origin is on the room allowlist, and it refuses URLs that look like signed-in account, token, billing, security, or credential pages. Those pages fall back to manual host review and show inline warnings.

### GitHub And Git

GitHub is used for identity in v1.

GitHub OAuth should trend toward incremental permissions. In the alpha, the relay exposes a configurable `GITHUB_OAUTH_SCOPES` value and the app displays the active scopes in Account settings. The default is `read:user public_repo` for open-source PR creation; self-hosters can use `read:user repo` when private repository PRs are required.

Git operations in v1:

- local git handles branch creation, commits, and pushes when the host machine is configured for it;
- GitHub OAuth/API handles PR creation and related GitHub metadata;
- branch names are normalized before local Git workflows and GitHub PR/Actions calls; whitespace, path traversal-like ref segments, `.lock` ref components, double slashes, `@{`, and other unsafe Git ref characters are rejected before anything reaches local git or the GitHub API;
- local Git branch names are capped at 200 characters, and commit messages are normalized to single-space text capped at 500 characters before approval previews or native git execution;
- local Git workflow stdout/stderr is capped at 120,000 characters per command with an explicit truncation marker;
- every commit, push, and PR action requires explicit host approval;
- Git workflow progress, results, and GitHub Actions refreshes are shared to the room as encrypted `git.event` envelopes, so peers can see branch, commit, push, PR, and CI outcomes without the relay seeing plaintext output.

GitHub Actions in v1 are a room-visible branch status surface. After GitHub sign-in, the active host can refresh workflow runs for the selected owner, repo, and branch when workspace mode is enabled and the room is unlocked. The desktop validates the owner, repo, and branch target before calling the relay-side GitHub proxy or publishing a room-visible Actions event. The loaded runs, last-checked timestamp, and status message are scoped to the current room so switching projects does not show another room's CI state. The UI summarizes whether the loaded runs are passing, failing, running, or unknown, and links directly to each run on GitHub.

When a room has an attached local project with a GitHub `origin` remote, the desktop infers the draft PR and Actions owner/repo target from that read-only git remote lookup. Manual owner/repo fields remain available and are not overwritten after the host edits them.

Before a host can approve a workflow that pushes and opens a draft PR, the desktop performs a GitHub readiness check. Local-only branch and commit workflows do not require GitHub sign-in. Push/PR workflows require a signed-in GitHub session, a relay with GitHub OAuth configured, PR-capable OAuth scopes (`public_repo` for public repos or `repo` for private repos), and normalized owner/repo/base/head values. The app shows any blocker before approval so a host does not run local git steps and only then discover that the PR cannot be created.

The open-source repo includes a GitHub Actions CI workflow. It checks, tests, and builds all TypeScript workspaces on Ubuntu; on the pinned `macos-15` runner it runs the shared `npm run verify` gate, including Rust formatting and native Tauri/Rust tests, then builds the unsigned desktop app and uploads the `.app` and `.dmg` artifacts for inspection. The repo also provides `npm run doctor` as a read-only local setup check for Node/npm/Rust/Cargo and macOS packaging prerequisites.

Example approval:

```text
Codex wants to:
- create branch multaiplayer/fix-chat-scroll
- commit 7 files
- push to maddiedreese/multAIplayer
- open a PR into main
```

Future option: GitHub App support for tighter repo-level permissions and cleaner self-hosted enterprise setups.

## 5. Privacy And Security

### Main Promise

The official relay stores account metadata and encrypted room metadata, but not plaintext messages or transcripts.

The relay may store:

- GitHub user id, username, avatar URL;
- AES-GCM encrypted GitHub session access tokens when relay session persistence is configured;
- device ECDH public keys and fingerprints;
- encrypted room metadata;
- encrypted message blobs until delivered;
- presence and routing metadata;
- invite state;
- abuse-prevention metadata.

The relay must not store:

- plaintext messages;
- plaintext transcripts;
- Codex tokens;
- OpenAI credentials;
- plaintext GitHub access tokens;
- repo contents;
- plaintext attachments;
- terminal output in plaintext.

### End-To-End Encryption

E2EE is required from day one.

This means cryptography, not cryptocurrency. No blockchain, tokens, wallets, or coins are involved.

Likely primitives/libraries:

- libsodium or a compatible audited crypto library;
- device ECDH identity keypairs;
- symmetric room keys;
- room-secret wrapping for member/device room-key distribution;
- authenticated encryption for messages and attachments.

Initial E2EE model:

- each desktop install creates a device ECDH identity key;
- the relay stores only the device public key and fingerprint for future mediated key exchange;
- each room has a symmetric room key;
- messages and attachments are encrypted locally before upload;
- the crypto package can seal invite workflow payloads and wrap a room key to a registered device public key without exposing the room key to the relay;
- gated invite links carry room metadata plus a host device public key, while direct convenience invite links can carry room secrets in URL fragments so the relay never receives the secret;
- active hosts can rotate room keys for future messages by publishing an encrypted `room.key` event under the current key;
- room keys and the device ECDH identity are stored in macOS Keychain in the native app, with localStorage used only by the web preview fallback;
- encrypted local history is stored on device;
- losing a device/key may make old local history unrecoverable until recovery is designed.

Hard parts to design carefully:

- member removal;
- key rotation;
- multi-device support;
- identity verification;
- history recovery;
- encrypted search.

### Encrypted Local History

Encrypted local history is enabled by default.

Defaults:

- 30-day retention window;
- configurable per room and team;
- team defaults apply to newly created rooms and can be explicitly applied to the current room;
- chat messages, terminal requests, terminal snapshots, browser approvals, Codex events, Git workflow events, GitHub Actions refreshes, host handoff packages, and saved Codex thread continuity in one versioned encrypted room payload;
- attachment cache encrypted;
- room keys in macOS Keychain in the native app;
- user can clear local room history, including local room messages, workflow records, and the saved Codex thread id;
- user can forget a room on one device, deleting local history, room history settings, the saved Codex thread id, the local room key, and the local visibility-warning acknowledgement; the room becomes locally locked until a fresh invite or room key is imported;
- user can disable local history for sensitive rooms.

### Secrets Visibility

By default, all room members see Codex event streams, terminal output, diffs, and tool logs.

The app must warn that secrets may be exposed. The first-time room warning covers full visibility, is acknowledged per room on the local device, and reappears after the user forgets that room locally. Inline warnings should appear for:

- `.env` access;
- environment variable dumps;
- credential-looking output;
- signed-in browser pages;
- file uploads from sensitive paths.

### Browser Use

v1 includes an isolated native WebView browser surface that Codex can use after host approval. On macOS, this is Tauri's platform WebView rather than the user's normal Chrome profile or a bundled Chrome session.

Security model:

- separate browser profile per room and active project path;
- room browser profile path and native guard status indicators are scoped to the selected room/project;
- state persists by default, with a room setting for refreshing the profile before each approved open and a host reset action;
- no access to the user's normal Chrome profile, cookies, passwords, extensions, or tabs;
- browser engine behavior follows the host platform WebView; the security boundary is room/project profile isolation plus host approvals and native guards, not a separate consumer-browser account container;
- explicit host approval before Codex can use a site;
- origin allowlist per room;
- downloads are blocked by the native room browser download handler;
- page Clipboard API calls are blocked by the native room browser guard script;
- file inputs and file drag/drop are blocked by the native room browser guard script until a later host-approved upload flow is designed;
- screenshots, DOM inspection, and network inspection are treated as sensitive;
- signed-in browsing shows inline warnings.

This is a contained tool surface, not the user's real browser.

### Computer Use

General computer use is not part of v1.

Future computer use must be:

- host-only;
- off by default;
- per-room opt-in;
- app allowlisted;
- never whole-desktop by default;
- no locked or unattended use by default;
- explicit about what Codex can see and control.

## 6. Codex Integration

The desktop app talks to local Codex via `codex app-server`.

The app-server is treated as the UI-to-agent protocol. multAIplayer is a rich client built on top of the Codex harness, not a hosted quota bridge.

The alpha shares Codex turn progress as encrypted `codex.event` room events. The event stream shows start, reported app-server events, completion, failure, model, host, and thread id where available, while the hosted relay only sees ciphertext envelopes.

Each room keeps a local Codex thread id on the active host device. The first approved turn calls `thread/start`; later approved turns pass the stored id through `thread/resume` before `turn/start`. The thread id is saved inside the room's encrypted local-history payload, so app restarts can resume the same local Codex conversation without putting that id in plaintext app preferences or relay state. If resume fails because the local Codex session is unavailable or stale, the host starts a fresh thread and records that fallback in the encrypted event stream.

The macOS app validates Codex turn input before starting `codex app-server`: empty turn input is rejected, desktop turn assembly trims oversized room context to 220,000 characters with an explicit truncation marker, native input is still hard-bounded to 240,000 characters, and native app-server timeouts must be between 10 and 900 seconds. If the app-server handshake fails after launch, the native host terminates the child process before returning the error.

Responsibilities:

- start or connect to local app-server;
- initialize a JSON-RPC session;
- start the first room thread and resume it on later approved turns;
- send turn input;
- pass the room-selected model to `thread/start`, `thread/resume`, and `turn/start`;
- stream turn events back into the room;
- surface approvals to the active host;
- map Codex events into chat/progress/file/diff/terminal UI;
- respect sandbox and approval configuration.

No custom system prompt is used. Room behavior should be shaped through:

- selected context;
- app-server configuration;
- room-selected model;
- sandbox policy;
- approval policy;
- available tools;
- browser/site permissions;
- project folder selection.

## 7. Desktop App Surface

### Primary Layout

```text
Left sidebar:
  Teams
  Rooms
  Projects
  Search
  Profile/settings drawer

Center:
  Chat room
  Codex invocation/progress
  Attachments
  Approval cards

Right sidebar / inspector:
  Files
  Diffs
  Git status
  PR details
  Browser preview
  Room settings

Bottom panel:
  Terminal
  Logs
  Codex event stream
```

### Required V1 Features

- GitHub sign-in;
- team/group creation;
- invite links with optional approval gate;
- encrypted group chat;
- encrypted local history;
- room and project search;
- one active project per room;
- one active Codex host per room;
- per-room model switcher;
- host handoff;
- `@Codex` mention and invoke button;
- host approval policies;
- local project folder attachment;
- file explorer and file viewer;
- red/green diff viewer;
- persistent named terminals;
- terminal command requests;
- isolated browser;
- GitHub PR creation;
- local git branch/commit/push;
- profile drawer for GitHub identity, session, and local device id;
- settings drawer for relay/Codex status, room modes, project, model, approval policy, and encrypted history;
- copy as Markdown for messages, threads, Codex output, diffs, and summaries;
- profile/settings.

### Copy As Markdown

The app should support copying:

- selected messages;
- a full room excerpt;
- Codex turn output;
- terminal output;
- diff summaries;
- PR description drafts.

Markdown export should make it easy to paste into GitHub, issues, PRs, docs, or another chat app.

Project, diff, terminal, and PR draft exports are local workspace actions when they include local project metadata. They are available only to the active host while the room is unlocked and workspace mode is enabled.

When the app detects sensitive material in project previews, diffs, or terminal output, the copied Markdown includes an explicit warning block. The alpha does not redact copied content automatically; it preserves the warning context so users can review before sharing outside the room.

## 8. Relay Architecture

The relay is boring infrastructure. It routes encrypted events and manages presence. It does not call OpenAI.

Responsibilities:

- GitHub OAuth session management;
- device registration and public keys;
- team and room metadata;
- sign-in-required workspace reads and mutations by default in production, with explicit self-host opt-out;
- configurable credentialed CORS origins for hosted/self-hosted relays;
- workspace/team metadata subscriptions for live sidebars;
- invite links and approval gates;
- presence;
- WebSocket event fanout;
- encrypted message delivery;
- encrypted attachment blob storage with expiry;
- self-host configuration;
- abuse/rate protections.

Non-responsibilities:

- OpenAI calls;
- Codex auth;
- plaintext transcript storage;
- plaintext attachment storage;
- running git commands;
- running terminals;
- executing AI tools.

## 9. Monorepo Plan

Initial repository structure:

```text
apps/
  desktop/        Tauri desktop app
  relay/          official and self-hostable relay

packages/
  protocol/       shared event/message schemas
  crypto/         E2EE room/device encryption
  codex/          Codex app-server JSON-RPC client
  github/         GitHub OAuth/API helpers
  git/            local git orchestration helpers

docs/
  product-architecture.md
  threat-model.md
  self-hosting.md
  protocol.md
```

## 10. Suggested V1 Milestones

### Milestone 1: Local Skeleton

- Tauri app boots on macOS.
- GitHub OAuth login.
- Local encrypted storage.
- Basic team/room/project model.
- Local-only chat prototype.

### Milestone 2: Relay And E2EE

- Self-hostable relay.
- WebSocket room transport.
- Device keys.
- Room keys.
- Encrypted messages and attachments.
- Invite links.

### Milestone 3: Codex Hosting

- Connect to local `codex app-server`.
- Host a room.
- Invoke Codex from chat delta.
- Stream Codex events to room.
- Approval sheet.
- Host handoff.

### Milestone 4: Coding Cockpit

- Attach local project.
- File explorer/viewer.
- Diff viewer.
- Persistent named terminals.
- Terminal command requests.
- Git status.

### Milestone 5: GitHub Workflow

- Branch/commit/push approvals.
- GitHub PR creation.
- Copy as Markdown.
- PR description drafting.

### Milestone 6: Isolated Browser

- Per-room native WebView profile.
- Site allowlist.
- Browser approval flow.
- Browser state persistence setting plus refresh/reset.

## 11. Open Questions

- Exact E2EE protocol and crypto library.
- Whether initial invite links carry room key directly or use a mediated key exchange.
- How to perform member removal and room key rotation.
- How to support multi-device identity.
- Whether official relay should support federation later.
- Whether GitHub App support should be added before public alpha.
- Exact Codex app-server lifecycle: bundled binary, discovered local install, or both.
- How to redact secrets from full room visibility without giving a false sense of safety.
