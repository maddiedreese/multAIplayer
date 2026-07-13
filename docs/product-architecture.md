# multAIplayer Product And Architecture Spec

Status: alpha product and architecture reference  
License: Apache-2.0  
Primary platform: macOS first  
Desktop stack: Tauri  
Repository: monorepo at `github.com/maddiedreese/multAIplayer`  
Public posture: Public Alpha

## 1. Product Thesis

multAIplayer helps teams build with Codex together.

People chat normally in rooms. When the group needs help, someone invokes Codex with a button or `@Codex`. The active Codex host approves the turn, and their local Codex works from the chat since the last Codex response, included attachments, the selected local project folder, browser state, and terminal context. Codex can make code changes, run commands, commit, push, and open a PR while the room watches together.

The core promise:

> multAIplayer does not store plaintext transcripts or hold AI credentials.

The short public pitch:

> Build with Codex together. Private by default. Open source.

## 2. Non-Goals

- Do not use OpenAI Platform API billing for the main Codex experience.
- Do not collect, proxy, or store Codex access tokens.
- multAIplayer does not offer Codex Browser Use while the app-server surface does not support it.
- Do not override Codex with a custom system prompt.
- multAIplayer does not offer Codex Computer Use while the app-server surface does not support it.
- Do not persist plaintext chat transcripts on the relay.
- Do not support multiple active projects in one room in v1.

## 3. Product Model

### Teams

A team/group is the top-level collaboration layer.

Teams can contain many project rooms. Membership is invite-based, with capability-authenticated approval by the active host.

Owners can promote members, demote admins, remove non-owner members, and transfer ownership to another team member. Ownership transfer is explicit and leaves a single owner; the previous owner becomes an admin.

Removing a member immediately closes that user's live relay sockets, blocks future reads, invalidates outstanding invites, and has the active host issue an MLS Remove Commit. Re-entry requires a fresh capability-authenticated KeyPackage invite. Previously delivered content cannot be erased.

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

Rooms and teams support relay-backed archive, restore, and soft-delete lifecycle actions. Archived rooms move out of the normal sidebar into an archived view and can be restored, but clients treat them as locked for chat, file, terminal, browser, Git, and Codex actions. Deleting a room or team removes it from workspace listings and prevents future normal use. Delete is not retroactive erasure: devices may already hold MLS/history state, copied exports, screenshots, or project data.

Room-level settings include:

- active project folder;
- active Codex host;
- selected Codex model;
- Codex reasoning, speed, and sandbox level;
- host approval policy;
- history retention;
- browser profile persistence;
- terminal list;
- invite links;
- local notification mute state;
- visibility/secrets warning acknowledgement.

The active project folder is a host-local path. The macOS app can attach it with a native folder picker or a pasted path. The relay stores the path as room metadata so members understand what project a room is about, but it never receives plaintext file contents. Project tree, file preview, diff, and Git status visibility is shared to room members through encrypted room-scoped app state. Terminal commands, Git mutations, file saves, browser opens, and Codex turns execute from the active host's local desktop app after host approval.

Native project file access is confined to the selected project root and rejects parent-directory or symlink escapes. File previews are read with a byte cap, and native diff output is bounded to 200,000 characters with an explicit truncation marker so generated files or large diffs do not overwhelm the desktop UI or copied context.

The workspace file editor uses Monaco Editor for the primary code editing surface. Monaco is embedded as an MIT-licensed dependency with attribution in `THIRD_PARTY_NOTICES.md`; multAIplayer owns the surrounding room/file selection, save, attachment-review, diff, and approval workflows.

Project file search, file editing, Git status, diff reads, and Git remote inference are room-visible project features while the room is unlocked. Active hosts can save file edits directly. Non-host file saves become encrypted file-save requests and require active-host approval before touching disk. Other mutating terminal, Git, browser, and Codex actions remain host-machine actions and require active-host approval before they run.

Desktop git-status summaries are scoped per room/project. Switching rooms clears the visible status for the incoming room until its own local `git status` read completes, so changed-file counts, PR drafts, and diff summaries do not reuse another room's project state.

The relay bounds metadata before storage and broadcast: team names, room names, WebSocket user/device identities, device ids, display names, live presence labels, host labels, avatar URLs, public key fingerprints, public key JWK blobs, project paths, and model ids all have explicit length limits and reject control characters where human-visible text is expected. Project paths are non-empty strings up to 2,048 characters, and model ids are known ids or model-like ids up to 80 characters.

The desktop client mirrors those bounds before creating teams/rooms, changing project paths or model ids, and accepting host handoff settings, so most invalid metadata is caught locally before it reaches the relay.

When the active host changes approval policy, Codex model, project path, or browser profile persistence, the relay metadata updates for routing/sidebar freshness and the desktop also sends an encrypted `room.settings` activity event. Room members see a system transcript message after local decryption, while the relay cannot read the human-readable before/after activity text.

### Active Codex Host

The active host is the user whose local desktop app talks to Codex app-server for a given room.

Only one Codex host is active per room. Hosting can be handed off. When hosting is handed off, the new host receives the room context needed to continue: encrypted local chat history, attachments, room metadata, and project association. After decrypting locally, the new host can approve Codex turns against the full available room context.

The desktop sends host handoff packages as encrypted `room.host` events. They summarize the project path, selected model, approval policy, recent-message count, attachment names, and terminal names so a new host can understand what they are inheriting before claiming the room. Accepting a handoff sends a second encrypted `room.host` acceptance event so the room roster stops presenting that handoff as available.

If the active host disconnects, the room remains available for human chat but becomes Codex-inactive until another member hosts.

## 4. Core User Flows

### Human Chat

Users chat normally in a room. Messages, replies, reactions, edits, deletes, attachments, and references are end-to-end encrypted before they reach the relay.

People can edit or delete their own pre-Codex messages while those messages are still mutable. When a Codex turn starts, the desktop records the consumed room message ids in the encrypted turn event; those messages stop showing edit/delete actions because they may already be part of Codex context. Queued Codex turns that have not started yet continue to refresh against the current room text.

Invite approval requests are capability-authenticated RFC 9180 HPKE payloads directed to the pinned host. An invite carries no group secret; it binds an independently generated 256-bit bearer capability and current epoch to the active host's exact identity, HPKE key, and signature-key fingerprint. The raw value exists transiently in the URL fragment and requester process memory, crosses the relay only inside HPKE ciphertext, and is persisted by the issuer only as a verifier. The request binds the exact single-use KeyPackage id/hash. After approval, the host publishes an MLS Add Commit and a one-shot Welcome usable only by that KeyPackage.

The Rust MLS state machine advances epochs through transactionally persisted Commits. Clients and relay accept Commits only from the active host, and the relay serializes one Commit per expected epoch. Member removal revokes relay access, invalidates outstanding invites, and excludes the removed leaf through MLS Remove; already-delivered content and retained history secrets cannot be erased. [The cryptography architecture](cryptography.md) defines the remaining policy and retention limits.

If a room is forgotten on the device, relay membership is revoked, or native MLS state is corrupt, the desktop treats it as locally locked. While locked, the app blocks room and host actions until a clean KeyPackage/Welcome rejoin. Rejoining restores future participation but not pre-rejoin history secrets.

Small text/code attachment previews can be embedded directly in MLS application payloads: up to 5 files per message, 80 KB per file, and 200 KB total preview content per message. Larger previews are exporter-sealed in Rust, uploaded as opaque blobs, and referenced from the MLS message by blob id. MLS messages are bounded before WebSocket fanout and backlog storage, so large previews use blob storage.

Codex approval distinguishes inline attachment content from encrypted blob references. Inline text previews are included in the Codex turn package after host approval. Encrypted blob attachments are listed by name and blob reference only in the alpha Codex turn package, so approving a turn does not silently decrypt and inject large files into Codex context.

Composer text and attachment drafts are scoped per room. If a user switches rooms, unfinished message text stays with its original room. If a large encrypted attachment blob finishes uploading after a switch, the finished attachment remains queued only for the room where the upload began.

Room goals use Codex thread Goal mode. After a room has an approved Codex thread, `/goal <objective>` calls Codex app-server's thread goal API. Pause, resume, edit, and clear controls update the active thread's goal. Encrypted local history stores the normalized thread graph and active selection, with the legacy thread id retained only as a compatibility mirror.

Project file previews and encrypted attachment blob opens are also tied to the originating room. If a room switch happens while a file read or blob decrypt is in flight, the completed read is ignored rather than rendered into the newly selected room's inspector. Attachment previews are blocked while a room is locally locked after forget or relay membership revocation.

The app keeps encrypted local history with a default retention window of 30 days. Retention is configurable per room, and each team can define the default retention policy inherited by newly created rooms. The local encrypted room payload includes chat messages plus workflow records such as terminal requests, terminal snapshots, non-host file-save requests, browser approvals, Codex events, Git workflow events, GitHub Actions refreshes, and host handoff packages.

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

Codex turn execution is an active-host local workspace action in the macOS app. The approval summary includes project path, Git status, terminal names, attachments, and approved browser context that Codex will receive. Stale approval sheets are rechecked at approval time before the app calls the local Codex app-server.

Codex invocations are proposed before they run. Any member can tag Codex or press invoke, but that creates a pending room-visible proposal. Only the active host, checked by stable host user id at approval time, can authorize the proposal to spend that host's Codex subscription or touch that host's machine. If host role transfers while a proposal is waiting, the proposal remains queued and the new active host can approve or decline it.

Codex proposals are queued when another proposal is pending or a turn is running. The queue is bounded to five waiting turns, renders in the room, can be cancelled by the requester or host, times out if host approval does not arrive, and is saved in encrypted local history so handoff/reload context stays coherent. Once a turn starts, server-initiated app-server requests are routed bidirectionally to the same active host/session. Human wait pauses active execution time but has a 15-minute wall-clock deadline; expiry and malformed or unauthorized responses fail closed.

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
- Never host this room.

Approval policies are host-side. They do not grant other users access to the host's Codex credentials, browser state, or shell. Every invocation becomes a proposal that requires the active host to approve before the local Codex app-server is called. High-privilege turns, such as full-access Codex or terminal/workspace/browser context, are called out distinctly in the approval sheet.

### Terminals

Rooms have persistent named terminal sessions per project room, such as:

- `tests`;
- `logs`;
- `shell`.

The terminal surface uses xterm.js as the emulator and a Rust PTY layer through `portable-pty` in the Tauri host. Before Rust starts either a one-shot command or an interactive PTY, the native app displays the exact command, room, and canonical working directory in an operating-system dialog. For a one-shot room request, the host can run once or choose “Repeat this command text for 10 minutes.” This in-memory grant binds those exact command bytes to that exact room and canonical workspace. The dialog warns that workspace files, scripts, hooks, configuration, and environment may change between runs. Rust performs matching and expiry; grants do not survive app restart and the terminal panel provides native-confirmed room revocation. They are never executable-name or command-family patterns. Every PTY input write still has its own native confirmation bound to the exact room, terminal session, and input bytes, with control characters escaped for review. Each confirmation issues a short-lived, one-use authorization that Rust atomically consumes before spawning or writing. The webview cannot authorize shell execution or inject input into an approved session by itself. New terminal creation, live terminal listing, terminal selection, restart, stop, and interactive input are active-host local workspace actions. The alpha does not present a separate command-composer UI beside xterm; users type directly into the terminal surface.

Terminal requests are MLS application events. The relay routes the opaque message but cannot read the command or event kind. The active host sees the requester and command before approving or denying it locally. Approved terminal requests always execute from the active room's selected project folder on the host machine; the host app does not trust a requester-provided working directory. Approval grants shell access on the host account, not a project sandbox.

The macOS alpha bounds approved one-shot terminal commands and interactive terminal input to 4,000 characters each, caps one-shot command output at 120,000 characters with an explicit truncation marker, and keeps the latest 1,000 output chunks per terminal session in memory. Terminal snapshots are saved in encrypted local room history as stopped/restartable sessions, so a room can remember its named terminal roster and recent output after reload without claiming the underlying OS process survived. The desktop room activity feed for terminal, Codex, Git, and Actions events is also scoped per room and capped to the latest 1,000 lines per room.

### Browser Requests

Browser mode is room-scoped. The active host can open a normal in-app browser column for the room, and Codex can ask to open a URL such as localhost in that same column. The browser surface is a Tauri/Wry WebView with room-scoped tabs, address entry, refresh, expansion, and URL-stack navigation. The room keeps multiple browser tabs in local UI state, and the selected tab is mounted into the active WebView surface. Browser URLs and signed-in pages are treated as host-visible room context, so Codex browser use stays behind the host approval boundary.

Browser access requests require an unlocked room. Browser approvals, denials, isolated browser opens, and browser profile resets require the current device to be the active host for that unlocked room.

Browser requests and decisions are MLS application events. The relay sees only an opaque MLS message, not the event kind, requested URL, reason, or decision details. Browser approval and denial decisions render as local system transcript messages after decryption, so room members can see the host-side browser audit trail without exposing it to the relay. Approved URLs can be opened as tabs in a room/project-scoped Tauri/Wry WebView surface on the host machine. Browser profile persistence is a host-controlled room setting: profiles persist by default, hosts can reset them manually, and refresh mode closes and clears the room/project browser profile before each approved open. The alpha keeps this as an explicit host action; deeper browser automation can be added behind the same approval boundary.

Codex Browser Use is not offered in multAIplayer because the Codex app-server API surface this app uses does not support it.

Local preview sharing uses `cloudflared` on the active host's machine to create a temporary Cloudflare Quick Tunnel for an explicit localhost or `127.0.0.1` URL. The relay does not proxy preview traffic; it only routes the encrypted room event that announces the generated `trycloudflare.com` URL. When a host shares a local build, the resulting URL is opened from the local preview card as a room browser tab inside multAIplayer, not as an external system browser tab. The host can stop the tunnel from the room, and copying the link remains an explicit separate action. See [local-preview-sharing.md](local-preview-sharing.md) for install and risk details.

### GitHub And Git

GitHub is used for identity in v1.

GitHub OAuth is configurable through `GITHUB_OAUTH_SCOPES`, and the app displays the active scopes in Account settings. The default is `read:user public_repo` for open-source PR creation; self-hosters can use `read:user repo` when private repository PRs are required.

Git operations in v1:

- local git handles branch creation, commits, and pushes when the host machine is configured for it;
- GitHub OAuth/API handles PR creation and related GitHub metadata;
- branch names are normalized before local Git workflows and GitHub PR/Actions calls; whitespace, path traversal-like ref segments, `.lock` ref components, double slashes, `@{`, and other unsafe Git ref characters are rejected before anything reaches local git or the GitHub API;
- local Git branch names are capped at 200 characters, and commit messages are normalized to single-space text capped at 500 characters before approval previews or native git execution;
- local Git workflow stdout/stderr is capped at 120,000 characters per command with an explicit truncation marker;
- every commit, push, and PR action requires explicit host approval;
- Git workflow progress, results, and GitHub Actions refreshes are shared as MLS application events, so peers can see branch, commit, push, PR, and CI outcomes without the relay seeing plaintext output or event kind.

GitHub Actions are a room-visible branch status surface. After GitHub sign-in, workflow runs can be refreshed for the selected owner, repo, and branch while the room is unlocked. The desktop validates the owner, repo, and branch target before calling the relay-side GitHub proxy or publishing a room-visible Actions event. The loaded runs, last-checked timestamp, and status message are scoped to the current room so switching projects does not show another room's CI state. The UI summarizes whether the loaded runs are passing, failing, running, or unknown, and links directly to each run on GitHub.

When a room has an attached local project with a GitHub `origin` remote, the desktop infers the draft PR and Actions owner/repo target from that read-only git remote lookup. Manual owner/repo fields remain available and are not overwritten after the host edits them.

Before a host can approve a workflow that pushes and opens a draft PR, the desktop performs a GitHub readiness check. On the official hosted relay, GitHub sign-in is required for identity and GitHub workflows. Local-only branch and commit workflows without GitHub sign-in may exist only for local/LAN or self-hosted relays configured without GitHub auth. Push/PR workflows require a signed-in GitHub session, a relay with GitHub OAuth configured, PR-capable OAuth scopes (`public_repo` for public repos or `repo` for private repos), and normalized owner/repo/base/head values. The app shows any blocker before approval so a host does not run local git steps and only then discover that the PR cannot be created.

The open-source repo includes a GitHub Actions CI workflow. It checks, tests, and builds all TypeScript workspaces on Ubuntu; on the pinned `macos-15` runner it runs the shared `npm run verify` gate, including Rust formatting and native Tauri/Rust tests, then builds the unsigned desktop app and uploads the `.app` and `.dmg` artifacts for inspection. Tauri is configured for those two macOS bundle formats only; Windows and Linux desktop bundles are outside the supported alpha surface until corresponding CI and release verification exist. The repo requires Node.js 22 or newer through package metadata, provides `.nvmrc` for the CI major, and provides `npm run doctor` as a read-only local setup check for Node/npm/Rust/Cargo and macOS packaging prerequisites.

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
- device MLS signature and HPKE public keys and fingerprints;
- public single-use KeyPackages and invite metadata;
- opaque MLS messages, sealed requests, and Welcome blobs until pruned;
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

The native implementation uses RFC 9420 MLS through `mls-rs`, the pinned P-256/AES-128-GCM/SHA-256 suite, and RFC 9180 HPKE for pairwise invite requests.

E2EE model:

- each desktop install creates MLS signature and HPKE identity keys in Rust;
- the relay stores only public identity records and public single-use KeyPackages;
- messages use MLS PrivateMessage sender authentication, epoch binding, and confidentiality;
- large attachments are exporter-sealed locally before upload;
- invite links carry an independent private bearer capability and exact host public binding, never an MLS group secret;
- the active host produces transactionally persisted Add, Remove, Update, and handoff Commits; clients and relay reject other committers;
- authenticated application metadata uses canonical serialization in MLS `authenticated_data`;
- MLS state and exporter-derived history secrets stay in encrypted native SQLite with Keychain-held wrapping material;
- the web preview is a seeded local demonstration and cannot participate in E2EE rooms;
- encrypted local history is stored on device;
- losing a device/key may make old local history unrecoverable until recovery is designed.

Member removal immediately revokes live sockets, future room joins, backlog reads, and blob reads. The active host then issues an MLS Remove Commit; the removed leaf has no later epoch secret. Content already received remains outside retroactive control.

Hard parts to design carefully:

- member removal;
- MLS state continuity and Commit ordering;
- multi-device support;
- identity verification;
- history recovery;
- server-side encrypted search.

### Encrypted Local History

Encrypted local history is enabled by default.

Defaults:

- 30-day retention window;
- configurable per room and team;
- team defaults apply to newly created rooms and can be explicitly applied to the current room;
- chat messages, terminal requests, terminal snapshots, non-host file-save requests, browser approvals, Codex events, Git workflow events, GitHub Actions refreshes, host handoff packages, and saved Codex thread continuity in one versioned encrypted room payload;
- sidebar chat search includes decrypted-on-device local history for rooms whose keys are still available, without creating a relay-readable search index;
- archived teams and rooms stay restorable; deleted teams and rooms are removed from workspace listings without claiming to erase content already received by devices;
- attachment cache encrypted;
- exporter-derived per-epoch history secrets in encrypted native storage;
- user can clear local room history, including local room messages, workflow records, canonical Codex activity, and the saved Codex thread graph;
- user can forget a room on one device, deleting local history, MLS state, saved Codex continuity, retained history secrets, and local warning acknowledgement; the room remains locked until a clean KeyPackage/Welcome rejoin, which does not recover old history;
- user can disable local history for sensitive rooms.

### Secrets Visibility

Room members can see content deliberately shared through chat, approved terminal results, diffs, Git/workflow events, and coarse Codex turn status. Canonical Codex activity shares lifecycle metadata only; it does not expose raw tool logs, commands, output, arguments, results, secrets, or token deltas.

The app must warn that secrets may be exposed. The first-time room warning covers full visibility, is acknowledged per room on the local device, and reappears after the user forgets that room locally. Inline warnings should appear for:

- `.env` access;
- environment variable dumps;
- credential-looking output;
- signed-in browser pages;
- file uploads from sensitive paths.

### Browser Use

v1 includes an isolated native WebView browser surface for approved room browser opens. On macOS, this is Tauri's platform WebView rather than the user's normal Chrome profile or a bundled Chrome session.

Security model:

- separate browser profile per room and active project path;
- multiple browser tabs per room, with one selected tab rendered into the active WebView surface at a time;
- room browser profile path and native guard status indicators are scoped to the selected room/project;
- state persists by default, with a room setting for refreshing the profile before each approved open and a host reset action;
- no access to the user's normal Chrome profile, cookies, passwords, extensions, or tabs;
- browser engine behavior follows the host platform WebView; the security boundary is room/project profile isolation plus host approvals and native guards, not a separate consumer-browser account container;
- explicit host approval before a room browser request opens a site;
- downloads are blocked by the native room browser download handler;
- page Clipboard API calls are blocked by the native room browser guard script;
- file inputs and file drag/drop are blocked by the native room browser guard script until a later host-approved upload flow is designed;
- screenshots, DOM inspection, and network inspection are treated as sensitive;
- signed-in browsing shows inline warnings.

This is a contained tool surface, not the user's real browser.

### Computer Use

Codex Computer Use is not offered in multAIplayer because the Codex app-server API surface this app uses does not support it.

Any future computer-control integration must be:

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

The alpha shares coarse turn state as encrypted `codex.event` room events and canonical item lifecycle metadata as encrypted `codex.activity` events. Activity projection is allowlisted and bounded: stable ids, type/status/timestamps, and limited normalized subagent relationships. The projector never copies raw app-server commands/output, tool arguments/results, upstream JSON, environment values, secret-bearing fields, account/auth data, token refreshes, or token/output deltas into room events or local room history. This does not change the separate, explicit sharing rules for chat, approved terminal results, or attachments.

Each room keeps a normalized encrypted Codex thread graph on the host device. The selected active thread drives `thread/resume`, `turn/start`, and goal operations. Hosts can list their active session tree, switch branches, and fork. Full forks work across the tested range; fork-through-turn using `lastTurnId` requires 0.143.0 or newer. Discovery fails closed until the active session is resolved and never imports prompt previews as titles. The separately rendered agent tree is derived only from normalized subagent activity and is not the conversation thread graph.

The supported contract range is Codex app-server 0.133.0–0.144.0. Older versions cannot host. Newer versions show an unverified warning, and contract-sensitive account, authentication, approval, and fork behavior remains capability-gated rather than inferred.

Room model settings are catalog intent. `auto` resolves model, reasoning effort, and service tier from the active host's local `model/list` defaults. `pinned` requests the stored choices; unsupported reasoning or service-tier selections fall back to a declared supported value with a visible warning. Legacy room selections remain pinned.

Account/login, app inventory, MCP authentication, login refresh, and the persistent global app-tool approval default (`auto`, `prompt`, or supported `writes`) are host-local control surfaces. They never become room events/history. `writes` trusts only tools declared read-only and prompts for writes; because it changes Codex config, it may affect other Codex clients on that host.

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

The alpha intentionally binds one primary repository/`cwd` per room. Multi-repository rooms are deferred until app-server provides a stable multi-root execution and sandbox contract; see [the accepted ADR](decisions/multi-repository-rooms.md).

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
- capability-authenticated invite links with host approval;
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
- file explorer and file editor;
- red/green diff viewer;
- persistent named terminals;
- xterm.js interactive terminal surface;
- isolated browser;
- GitHub PR creation;
- local git branch/commit/push;
- profile drawer for GitHub identity, session, and local device id;
- settings drawer for relay/Codex status, project, model, approval policy, and encrypted history;
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

Project, diff, terminal, and PR draft exports are room collaboration features when they include shared project metadata. Host-machine mutations still require active-host approval.

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
- capability invite links and authenticated device approvals;
- presence;
- WebSocket event fanout;
- encrypted message delivery;
- encrypted attachment blob storage with expiry;
- self-host configuration;
- abuse/rate protections.

The relay keeps its composition and domain boundaries explicit. `relay-app.ts` wires configuration, lifecycle, route, WebSocket, and persistence adapters; HTTP room creation/settings/host/lifecycle handlers live in separate route modules; WebSocket admission, validation, and dispatch are independent; and persistence exposes a small facade over JSON compatibility and SQLite schema/entity/MLS repositories. HTTP failures carry a stable protocol error code in addition to bounded prose. Authenticated `/metrics` output uses the Prometheus text exposition format.

Non-responsibilities:

- OpenAI calls;
- Codex auth;
- plaintext transcript storage;
- plaintext attachment storage;
- running git commands;
- running terminals;
- executing AI tools.

## 9. Repository Layout

The repository is a monorepo:

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

## 10. Alpha Scope And Limits

- E2EE uses RFC 9420 MLS through the native Rust core, one pinned ciphersuite, canonical authenticated application metadata, exporter-derived encrypted history, and RFC 9180 HPKE capability requests.
- Desktop coding surfaces use Monaco Editor for file editing, xterm.js with a Rust PTY layer for terminals, and Tauri/Wry WebViews for room browser tabs.
- Invite links carry a random capability and exact host public binding, never a group secret; approval consumes the requester's exact KeyPackage and returns an MLS Welcome.
- Member removal is relay-enforced for future reads and live sockets and cryptographically enforced for future room epochs through authenticated per-device delivery.
- Multi-device support is device-oriented: each device has its own registered and pinned key identity. Recovery and synchronized multi-device identity remain outside the alpha scope.
- Official relay federation is not part of the alpha scope.
- Relay SQLite storage applies immediate, incremental row upserts/deletes for durable entities and transactionally groups MLS messages, receipts, room epochs, and related state. It does not serialize or rewrite the whole store during steady-state operation. State is still hydrated into one process at startup, so one relay writer per SQLite database remains the alpha deployment boundary; multi-instance operation requires shared coordination and rate limiting.
- GitHub OAuth is the public alpha GitHub integration. GitHub App support is a future option for tighter repo-level permissions and enterprise setups.
- The desktop discovers and runs the local `codex app-server`; multAIplayer does not proxy Codex credentials through the hosted relay.
- Secret detection is a review aid for files, terminal output, received terminal command requests, browser pages, and copied Markdown. The alpha warns and gates risky sharing without claiming automatic redaction.

## 11. Recoverable Failure Policy

Desktop code must not silently discard a caught failure. Unexpected recoverable failures route through `reportNonFatal()` so the bounded, redacted diagnostics ring can count them. Expected control-flow failures, such as rejecting a malformed URL or fitting a hidden terminal, use `reportExpectedFailure()` with a static operation name. Attacker-controlled payloads, URLs, tokens, and plaintext are never passed as operation names or diagnostic details.

Bare catches are lint-enforced. Diagnostics serialization and persistence use static debug messages directly to avoid recursive reporting. A catch that intentionally presents an actionable error to the user may bind the error and handle it in the relevant UI state; it must not leave an empty fallback.
