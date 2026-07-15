# Using The App

This guide explains the main desktop app surfaces and what each feature means in the public alpha.

Security-related user guidance here explains operation; the [threat model](threat-model.md) is the sole normative claims and residual-risk source.

## First-Time Setup

On a fresh install, the setup guide opens before the normal workspace shell. Choose **Create a workspace** to create a team and its first project room, or **Join with an invite** to request access with a capability invite. **Explore the interface** closes the guide without claiming that setup is complete. Progress is resumable: **Save and close** pauses at the current step, and the Help drawer can reopen or restart the guide and restore the setup checklist.

The readiness screen checks the relay, GitHub identity, the local Codex installation, the ChatGPT account used by Codex, and project-folder selection. Blocking rows keep Continue disabled and provide a direct repair action. Warnings describe optional or deferrable work. The create path requires host readiness: relay access, any GitHub identity required by that relay, a compatible Codex installation, and any ChatGPT authorization Codex reports as required. The join path blocks only on relay access and GitHub identity; an invitee can join without installing or signing in to Codex and attach a project later. GitHub and ChatGPT are separate:

- GitHub identifies workspace members and enables repository workflows. Whether it is optional depends on the relay and the selected create/join path.
- ChatGPT authorizes the local Codex process that performs work on the active host device.

Both sign-in flows are usable without leaving the blocking assistant. GitHub uses Device Flow: the assistant shows the user code, expiry guidance, an explicit system-browser action, and cancel/restart controls while the relay polls GitHub. Codex supplies either a ChatGPT browser authorization URL or a device code through the local app-server. The full GitHub device code used for polling and the Codex login id remain controller/native state and are never onboarding fields. Before opening either provider, TypeScript validates the exact HTTPS provider URL and the native command independently validates it again before asking the operating system to open the default browser. If opening fails, the assistant offers an explicit copy-link fallback. Authorization URLs and codes are memory-only and disappear on cancellation, completion, expiry, or app exit.

The create path asks for a workspace name, first room name, and project folder. If team creation succeeds but room creation fails, the guide remembers only the bounded team identifier and retries the room instead of creating a duplicate team. Teammates are invited after the room is ready through the normal capability-invite flow; the create form does not collect usernames. The join path validates the invite locally, publishes the device-bound access request, and explains when the active host must verify and approve the device. An invite is not accepted merely because it was pasted into the guide.

New rooms begin with the normal conservative defaults: ask before every Codex turn, workspace-write sandboxing, raw-reasoning sharing off, restricted browser access, and the displayed local-history policy. The advanced room settings remain available after setup.

Inside the room, the first-turn guide identifies the active host, offers starter prompts that populate rather than send the composer, explains the approval card, and points out live thinking, command/output, edit, tool, and subagent activity. It never sends a prompt or approves a turn automatically. The sidebar checklist tracks five milestones: connect Codex, create or join a room, attach a project, finish the first Codex turn, and add a teammate. “Not now” explicitly defers the teammate step without claiming that someone joined; actual completion is observed from room membership.

Setup state is local to this app installation. It contains a version, bounded team/room identifiers needed for resume and duplicate-prevention, and boolean progress markers. Invite links, project paths, form drafts, prompts, account details, GitHub Device Flow values, Codex login ids/URLs/codes, secrets, and project content are not stored in onboarding state, and the app sends no tutorial telemetry. Project and authentication fields stay in memory while the guide is open. A pasted invite is read directly from the input and cleared before submission. A native universal link is kept in one bounded, one-shot native memory slot, transferred once into React memory, and cleared after delegation; a newer unopened link replaces an older one and app restart discards it. If relay loading, authentication, Codex detection, folder access, room creation, or invite approval fails, the current screen keeps a bounded explanation and a direct retry or repair path.

## Account And Device

Use the profile drawer to sign in with GitHub, sign out, inspect relay auth settings, and save diagnostics for bug reports.

The same drawer has host-local Codex controls. It can show the local Codex account, apps, and MCP authentication status; start Codex browser/device login or MCP OAuth; and set the device-wide app approval default to `auto`, `prompt`, or supported `writes`. These controls use the host's local app-server and persistent Codex config. They are not shared room settings, and Codex tokens, login refresh data, and raw account/app/MCP responses never enter room events or room history.

GitHub sign-in is used for identity, draft pull requests, and GitHub Actions reads. Native Rust stores the access token in macOS Keychain and calls GitHub directly; the webview never receives it. The relay observes it once during sign-in identity verification and immediately discards it.

GitHub sign-in opens the operating system's default browser at GitHub's device-verification page and displays the short user code in the app. There is no redirect URI back to multAIplayer; the relay polls GitHub and the app observes completion. ChatGPT sign-in is a different browser or device-code flow owned by the local Codex app-server. Neither provider's credentials are exchanged with the other.

Each desktop install has a device identity used for encrypted invite approval and room-key delivery. The profile drawer shows the local device id and public key fingerprint. Resetting the device identity creates a new local device key, which can make other room members see the device as untrusted until they review the new fingerprint.

`Save diagnostics` opens the system save dialog in the native app. Rust validates and re-redacts the owner-only diagnostic records, assembles the JSON bundle, and writes it directly to the selected file; stored entries and bundle contents are never returned to the webview. Capture-redacted warning/error entries are retained for up to seven days, 256 KiB, or 500 entries, whichever bound is reached first. The bundle is designed to exclude transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, and GitHub tokens. Review the saved bundle before attaching it to an issue. Browser builds show only a native-app notice and expose no diagnostics action.

The Account drawer links the [Privacy Policy](https://multaiplayer.com/privacy) and [Terms of Service](https://multaiplayer.com/terms) and exposes deletion for official-relay account data. There is no independent multAIplayer password account: the hosted account is the signed-in GitHub identity plus its relay sessions, device registrations, and memberships. Before deletion, transfer or delete every team you own and hand off every room you host. The confirmation explains that deletion removes your sessions, devices, KeyPackages, memberships, and pending invite artifacts but cannot retract shared team/room records, opaque MLS ciphertext, encrypted blobs, or accepted receipts already relied on by other members. Local encrypted room state is separate; use **Forget on this device** in each room before deleting the hosted account if you also want to remove that Mac's saved history and project/Codex room configuration.

## Teams, Rooms, And Search

The left sidebar contains teams, active rooms, room creation, GitHub sign-in, theme switching, search, and an archived view for archived teams and rooms.

Teams group related project rooms. A room is the collaboration space for one active project folder at a time. Project paths and Codex model/tuning settings reach members through end-to-end encrypted room configuration rather than public relay metadata. Search covers room names, locally available project paths, room metadata, and decrypted-on-device local chat history for rooms whose local keys are available.

The team roster shows owner/admin/member roles. Owners can promote members, demote admins, remove non-owner members, and transfer ownership. Removing a member revokes future relay access, closes live sockets, and invalidates outstanding team invite metadata, but it does not erase content or keys that member already received.

Teams and rooms can be archived or deleted from the sidebar. Archiving moves rooms out of the normal sidebar into the archived view and keeps them restorable, but pauses normal room activity until restored. Deleting removes the team or room from the workspace for members going forward. It does not erase local copies, screenshots, copied Markdown, project files, or ciphertext already delivered to devices.

## Members And Device Trust

The Members panel shows live room presence, host status, device labels, and device key fingerprints.

`keyed` means a member has a registered public device key. Fingerprints are the full SHA-256 digest of the canonical P-256 public key. Invite enrollment recomputes and pins the exact authenticated user, device, key, and fingerprint; a changed known key fails closed and must be reviewed as a new device identity. Copying a fingerprint supports an additional out-of-band comparison.

## Chat

Room chat supports encrypted messages, replies, reactions, attachments, local edits, and local deletes. Human and Codex messages use the same safe Markdown presentation: inline backticks render as inline code, and triple-backtick fences render as scrollable code blocks with an optional language label and a copy control. Message Markdown is rendered by the app's bounded parser rather than as arbitrary HTML. A user can edit or delete their own message only before Codex consumes it in a started turn or accepted steering message.

Typing `@Codex` or clicking the Codex button proposes a Codex turn. While a turn is running, the active host can choose **Steer current turn** or **Queue next turn** above the composer. Steering sends the text through app-server `turn/steer` with both the current thread id and expected active turn id; it does not create another turn. Queueing creates the existing room-visible, host-approved proposal, which refreshes against current chat until it starts. Steering is active-host-only and text-only; collaborators' proposals and follow-ups with attachments use the queue. The choice is a local device preference and contains no room content.

`/goal` sets a Codex thread goal after the room has an approved Codex thread. Goals use Codex Goal mode through app-server: Codex keeps the objective attached to the thread, and the app shows Codex-reported status such as active, paused, blocked, usage-limited, budget-limited, or complete. Pause, resume, edit, and clear actions update the Codex thread goal.

## Attachments

The host can attach project files to chat from the file editor. Small text/code previews can be embedded directly in encrypted chat payloads. Allowlisted PNG, JPEG, WebP, and GIF attachments can render inline for both user and Codex messages; SVG, remote URLs, local file paths, malformed data, and unsupported media stay out of the ambient inline-image path. Larger previews are encrypted locally, uploaded to relay blob storage as ciphertext, and opened from the file preview pane after local decryption.

When the local Codex app-server returns an image-generation result, the native boundary accepts only bounded allowlisted raster data, gives it a generated safe filename, and publishes it as an encrypted chat attachment beside the Codex response. Small images can travel inline. Larger images use an exporter-encrypted relay blob and may include a bounded inline thumbnail; the relay sees blob metadata and ciphertext, not image pixels or the image-generation prompt. The app does not persist or share an upstream local output path. The default relay blob lifetime is 30 days, subject to the self-hosted relay's configured attachment retention, while locally decrypted attachment records follow the room's encrypted local-history retention and clearing controls.

The app shows review warnings for files that look like `.env` files, credentials, private keys, or environment dumps. These warnings are review aids, not complete secret scanners. If the host attaches a sensitive file anyway, everyone in the room may see it and it may enter approved Codex context.

## Codex Approval

Codex runs through the active host's local Codex app-server/session. Any room member can request a turn, but only the active host can approve execution on the host machine in the alpha.

The approval card shows what Codex will receive, including chat context, attachments, model, sandbox, project path, Git status, terminal names, and browser access when those contexts are enabled. High-privilege context is called out before approval.

Approval presets are host-side labels:

- Ask every Codex turn: every turn requires active host approval.
- Never host this room: this device should not host Codex for the room.

The Codex sandbox controls the local Codex app-server request:

- Read-only: inspect workspace; changes and boundary crossings need approval.
- Workspace write: edit the room project; network/out-of-workspace actions need approval.
- Workspace + network: edit the room project and use network access inside the sandbox.
- Full access: broad local access; use only in fully trusted rooms.

Reasoning and speed controls are passed to supported Codex models. A custom model id can be entered when the target local Codex installation supports it.

Model, reasoning, and speed/service-tier controls can be automatic or pinned. Automatic choices follow the active host's local app-server catalog. Pinned choices are used when supported; otherwise the app shows the catalog fallback selected for that host. The supported compatibility range is Codex 0.133.0 through 0.144.0, with generated-schema fixtures at 0.133.0, 0.143.0, and 0.144.0. Older versions must be updated before hosting, while newer versions show an unverified-version warning and keep contract-sensitive features fail closed. `node scripts/doctor.mjs` reports the installed Codex version against this range; no installed Codex CLI is an optional setup result, while an installed too-old or unreadable version fails the development setup check.

Codex can pause a running turn to ask the active host for a command, file, permission, tool-input, MCP, or authentication decision. These requests are room-scoped and bidirectional; answering the proposal card is separate from answering later app-server requests. A pending app-server request expires after 15 minutes of human wait.

The Codex work disclosure appears in chat as a collapsible “Codex is working” or “Codex worked” group. Each typed step has its own disclosure for the information Codex reported: reasoning summaries; command text, bounded output, exit status, and duration; changed paths and bounded diffs; tool name, bounded input/result/error; web action, query, page, or find pattern; image-generation prompt; and subagent prompt, model, reasoning effort, state, and normalized spawn/send/resume/wait/close relationships. The adjacent agent visualization uses those normalized relationships so room members can see subagent spawning and progress without confusing it with the Codex conversation branch graph.

“Thinking” shows provider-supplied reasoning summaries by default. The active host can enable an off-by-default, per-room setting to share provider-supplied raw reasoning when the selected provider, model, and app-server build make it available. Enabling the setting does not guarantee that a turn will produce raw reasoning. When present, raw reasoning appears behind its own disclosure and is treated like other room activity: it is bounded, encoded through RFC 9420 MLS via `mls-rs` before relay transport, visible to room members, and retained in their encrypted local history according to the room retention window. Turning sharing off prevents raw reasoning from being included in later projected activity; it does not retract copies already delivered or retained by members. The threat model owns the assurance and audit status for this path.

These structured details are schema-validated, but they are not a secret scrubber: reasoning, commands, output, diffs, tool data, URLs, prompts, and Codex-reported paths can contain sensitive project information. The activity history retains at most 160 records per room. Raw upstream notification JSON, unknown fields, environment/account/authentication state, token refreshes, token deltas, and streaming output deltas are not copied wholesale into room activity.

After a thread exists, the thread graph can refresh the active session tree, switch the active branch, or fork it. An optional last-turn id forks through that turn on Codex 0.143.0 or newer. The selected thread is used for the next turn and `/goal`. The adjacent agent tree is a different view derived from normalized subagent activity; it is not the conversation branch graph.

## Host Handoff

Host handoff lets the active host pass continuity to another eligible member, including when the host hits Codex usage limits or needs to step away.

A handoff package can include recent-message counts, queued Codex turns, attachment names, terminal names, model, project path, Git repository metadata, dirty-file names, and an encrypted patch when small enough. The replacement host uses their own Codex access and local project folder. If their already-attached project has the expected GitHub remote, the app reuses that locally approved path; otherwise, the replacement host must explicitly select a matching clone or a destination for cloning.

## Project Files And Diffs

The Project panel attaches the active host's local folder to the room. Room members can browse the shared project tree, open text file previews, inspect diffs, view Git status, and copy Markdown summaries while the room is unlocked. Project reads are bounded and room-scoped.

The file editor can open files, show diffs for changed files, expand into a larger view, attach the selected file to chat, and save edits back to disk. Active hosts can save directly. Other room members can edit and request a save; the active host must approve before the change touches disk. File previews and diffs are bounded; truncated files cannot be saved from the editor.

The **Changed files** section is a host-local snapshot of the active project's Git working tree. It is populated from `git status --porcelain=v1`, so it includes tracked staged and unstaged changes plus untracked files relative to the current checkout and index. The app refreshes that snapshot when it attaches or switches the selected room/project and after its terminal or Git workflow actions; it is not a continuous filesystem watcher, so an external edit can remain stale until another refresh trigger. It is **not** a comparison with the last merged pull request, the merge base, or the remote default branch. A file that was committed locally no longer appears even if that commit has not been merged, while an older uncommitted change continues to appear. To review every commit since a merged PR, use an explicit Git range or the GitHub pull request view.

The per-file diff preview currently shows the unstaged working-tree diff, with a generated new-file diff for untracked files. A staged-only file is still present in **Changed files**, but can have no diff text in that preview. The small `+`/`-` values in the list are status indicators for added, untracked, or deleted files rather than full line totals; review the opened diff for actual content.

`Markdown` copies a project/file summary. `Summary` copies a changed-file summary. If clipboard access is blocked, the generated Markdown appears in an in-app fallback panel.

## Terminals

The Terminals panel manages room-scoped host-local terminals. The active host can open, type into, restart, close, and copy terminal output as Markdown.

Non-host members can request exact terminal commands. The active host sees the requester, command, working directory, and warnings before approving or denying. The native app then presents an operating-system confirmation containing the exact command, room, and working directory immediately before execution. Starting or restarting an interactive terminal uses the same native confirmation boundary, and each subsequent input write requires native confirmation of its exact bytes; control characters such as Enter and Escape are shown in escaped form. Approved requests run from the selected project under a macOS OS sandbox profile. Filesystem writes are confined to that canonical project, while reads from the project and named system/toolchain paths, child processes, inherited environment, and network access remain available. Treat this as project-filesystem confinement, not complete host isolation.

Terminal output is visible to the room when shared through terminal request results, Codex events, copied Markdown, or approved context. Secret-looking commands and output get warnings, but hosts should review carefully.

## Browser

The Browser panel opens a room/project-scoped in-app browser surface on the active host's machine. It is not the host's normal Chrome profile.

The browser profile persists by default so signed-in sites can work inside that isolated room/project context. Hosts can reset the profile or use refresh mode, which clears the room/project browser profile before each approved open.

Browser opens requested by Codex or other room events go through the host approval boundary. The browser blocks downloads, page Clipboard API access, file inputs, and drag/drop uploads where the native platform allows it. Signed-in pages can still expose sensitive content to the room if the host shares or approves that context.

For sharing a running localhost web app through a public URL, see [local-preview-sharing.md](local-preview-sharing.md).

## Git And GitHub

Local Git workflows run on the active host's machine. The host can create a branch, commit, optionally push, and open a draft PR after reviewing the approval preview.

Treat Codex responses, webpages, attachments, pasted text, and requests from room members as untrusted. A native command dialog is a security decision, not a routine notification. For a repeated one-shot room command, “Repeat this command text for 10 minutes” remembers only the exact displayed command in the displayed canonical workspace and room; the dialog warns that workspace files, scripts, hooks, configuration, and environment may change. Restarting the app or selecting “Revoke repeats” in the terminal panel clears grants after native confirmation. Each interactive input write always requires its own exact native confirmation. npm, Git, and similar tools can execute project scripts, hooks, and configuration, so their names alone are never an automatic safety boundary.

On the official hosted relay, GitHub sign-in is required. Local-only branch/commit workflows without GitHub sign-in may be available only on local/LAN or self-hosted relays configured without GitHub auth. Push, draft PR creation, and GitHub Actions refreshes require GitHub sign-in on a relay configured for GitHub OAuth with appropriate scopes.

The GitHub Actions panel reads workflow runs for the selected owner, repo, and branch. When the room has a GitHub `origin` remote, the app can infer owner/repo fields; the host can also edit them manually.

Git workflow progress and Actions refreshes are shared to the room as encrypted events so other members can follow branch, commit, push, PR, and CI status without the relay reading plaintext Git output.

## Invites And MLS Membership

The Invites panel can copy or import a capability-authenticated invite and approve or deny validated device/KeyPackage requests. MLS epoch changes happen through active-host Commits rather than manual room-key rotation.

The active host generates a canonical HTTPS link under `open.multaiplayer.com`. Every invitation field is after `#`: the relay invite id, encoded capability/host binding, and `approval=request`. Browsers do not send that fragment in the HTTP request. The app defines no `multaiplayer:` or other custom scheme.

On a signed macOS release, clicking the link can open an installed app through Apple's universal-link association. The native parser accepts only HTTPS, the exact apex or `open` host, `/invite` (with a tolerated trailing slash), no query, credentials, or port, exactly one of each expected fragment field, bounded base64url values, and `approval=request`. It rejects ambiguous batches and never emits the URL in its availability event. If the app is already running, it focuses the main window; on cold start the frontend subscribes before draining the same one-shot slot.

If the app is absent or universal-link dispatch does not occur, the static landing page immediately scrubs the fragment before hydration and renders no capability. It offers a download only when the release manifest identifies a supported signed DMG; no supported public build has been published yet. After installing a supported release into Applications, explicitly try **Open multAIplayer** again. That retry navigates to the other associated HTTPS host using only an in-memory copy of the validated link. Refreshing, closing, or navigating away loses that copy; return to the original private message and click again. The landing has no cookies, analytics, telemetry, storage, automatic clipboard write, or custom-scheme fallback.

Invite links never include an MLS group secret. They contain a 256-bit join capability, the current epoch, and the active host's exact user/device public binding and full signature-key fingerprint. The join request is capability-authenticated, RFC 9180 HPKE-sealed to the host, and bound to the joiner's exact KeyPackage. Approval publishes an MLS Add Commit and delivers a one-shot Welcome to that authenticated device.

Share the complete invite link privately. Its capability is not a room key, but it is a single-use bearer secret: anyone holding the link can submit a device-bound request for host review. Import scrubs the fragment from browser history. The app validates and pins the requester's full device fingerprint before display; the host should review the requesting identity and device id before approval.

Removing a member first revokes relay access and then advances the group through an active-host MLS Remove Commit. The removed leaf receives no new epoch secret and cannot decrypt future events. Removal cannot erase content, exports, screenshots, or retained history already delivered or copied.

## Local History, Notifications, And Forgetting A Room

Local history is encrypted on the device and has a configurable retention window. It can include chat and image-attachment records, workflow events, terminal snapshots, browser approvals, Codex turn events, bounded structured Codex activities, Git events, GitHub Actions refreshes, host handoff packages, local previews, and the normalized Codex thread graph/active selection. Encrypted attachment blobs have their own relay-side expiry, so a retained message or thumbnail does not guarantee that a larger original blob remains downloadable.

The current project path and Codex model/tuning configuration are also saved in the native SQLCipher store, whose wrapping key is held in the operating-system credential store. This lets a host retry an encrypted configuration snapshot after reconnecting or restarting; the relay sees only MLS ciphertext.

**Clear history** removes saved local room history and retained history secrets while keeping the current project/Codex configuration. **Forget on this device** removes both the saved history and that durable configuration, clears local room UI/settings records and warning acknowledgements, and locks the room in the app until it completes fresh host approval. Rejoining does not restore pre-rejoin history secrets.

Room notifications can be muted per room. Muting affects local notifications/unread attention on that device; it does not mute the room for other members.

Team defaults control settings for newly created rooms, including local history retention, default approval policy, default model, browser profile persistence, and whether new room invites require host approval.

### Encrypted room export and read-only import

Open **Room settings → Encrypted room archives** to export the selected room. The same library also appears in **Account**, so imports remain reachable while signed out, offline, or without a live room. Enter a passphrase of at least 12 bytes twice, choose a `.multai.age` destination, and keep the passphrase separately; multAIplayer does not store it or offer password recovery. The file uses the interoperable age passphrase format and is written owner-only. The export contains normalized display history available on this device at export time. Pending terminal/browser/file approvals, queued Codex turns, host handoffs, invite state, MLS/device secrets, Codex session/thread ids, browser profiles, running terminals, and attachment-blob ciphertext are omitted. Inline attachment and resolved file-review content can still be sensitive, so use a strong unique passphrase.

**Import archive** decrypts and validates a selected archive, stores its still-encrypted bytes in the native archive library, and opens an inert view. The library list intentionally shows only “Locked archive,” import time, and encrypted size until the correct passphrase is entered; plaintext room/team names are not indexed. Opened messages and activity pass through the normal local-history validators. Import never adds a room to the sidebar, restores membership, sends an event, starts a process, grants an approval, or restores MLS state. Deleting an imported archive removes its encrypted library copy but does not delete an external export file. See [Encrypted room archives](room-archives.md) for bounds and recovery limits.

## Updates

The app checks `releases/latest.json` on this repository's pinned HTTPS `update-channel` branch when the app shell mounts. The release workflow advances the manifest only after the complete GitHub Release is published, including prereleases. Before showing the banner, native Rust verifies authenticated metadata binding the claimed version, exact updater archive URL, archive signature, and displayed notes, and rejects non-increasing versions. When a valid newer version exists, the banner offers **Install signed update**; nothing downloads until you choose it. Tauri separately verifies the downloaded updater bundle against the public key embedded in the app before installation, then relaunches the app. The banner also links to independent checksum/Sigstore verification instructions, and a failed updater leaves the manual GitHub Release path available. Supported public builds are Apple-silicon-only, Developer ID signed, notarized, and produced by the tagged release workflow. No supported public build has been published yet.

## Accessibility and localization

### Current support

The alpha UI is English-only. User-facing strings live alongside React components; there is no translation catalog or right-to-left layout guarantee. Do not describe the application as localized until those foundations and at least one non-English locale are tested.

Accessibility is a release quality requirement even before formal conformance certification. Required Playwright journeys run exact-pinned axe-core WCAG 2.0, 2.1, and 2.2 A/AA rules against the production-component chat, onboarding, and invite scenarios in addition to exercising semantic roles and accessible names. The desktop runner also includes both `.test.ts` and `.test.tsx` component suites. These automated checks catch regressions but do not establish conformance or replace the release audit below.

The first-run setup uses one heading and native buttons, links, inputs, forms, details, lists, status regions, alerts, and progressbar semantics. Moving between setup surfaces transfers focus to the new heading without trapping focus. Readiness is communicated with text as well as icons and color; blocking states disable forward progress and expose a named recovery action. Async invite, folder, and workspace outcomes use status or alert regions rather than relying on a transient visual change.

Authentication keeps the GitHub user code selectable and copyable, states its expiry in text, and provides named Open, Copy, Cancel, and retry actions. GitHub and ChatGPT/Codex are labeled as different accounts and purposes. A failed system-browser launch becomes an alert with a copy-link fallback instead of an inaccessible silent failure. Native invitation activation announces that an invitation is ready without placing the bearer capability in an accessibility name, notification, or persistent region.

Create and join are peers in the reading and tab order. Back, Save and close, Explore, checklist dismissal, and Help-based reopen/restart controls make the flow skippable and resumable without requiring pointer input. Starter prompts are buttons that populate the composer only, so keyboard and assistive-technology users retain the same explicit send and approval boundaries as pointer users.

The setup surface reflows to a single narrow column. Progress transitions are removed under `prefers-reduced-motion`. Text labels remain visible for icon-only controls through accessible names. Copy should stay sentence-cased and plain-language; readiness and recovery text must not interpolate raw paths, tokens, account responses, or upstream errors.

### Release audit

Before a public release, record an audit issue covering keyboard operation and focus; VoiceOver on the supported macOS version for sign-in, invite acceptance, host handoff, Codex approval, messaging, settings, and recovery; 200% text zoom, narrow-window reflow, reduced motion, and contrast; axe checks plus manual review; labels, status announcements, validation, dialogs, and icon-only controls; and WCAG 2.2 AA color contrast.

Record the commit, OS/browser versions, assistive technology, findings, severity, owner, and remediation status. A finding that prevents a security approval, sign-in, messaging, or recovery flow blocks release.

### Localization-ready changes

Avoid concatenated sentence fragments, text embedded in images, assumed English word order, and color-only meaning. Use platform internationalization APIs for dates, times, numbers, and plurals, and tolerate longer labels. A future localization change should add typed message identifiers, extraction, fallback tests, and pseudo-localization before accepting translations.

Authentication expiry, remaining-time, and retry copy must use localized date/duration and plural rules rather than English string concatenation. Provider names, security terms, invite fragments, and user codes should remain separate interpolation values so translations cannot accidentally change their parsing or copy behavior.
