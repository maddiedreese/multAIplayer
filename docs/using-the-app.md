# Using The App

This guide explains the main desktop app surfaces and what each feature means in the public alpha.

## Account And Device

Use the profile drawer to sign in with GitHub, sign out, inspect relay auth settings, and copy diagnostics for bug reports.

GitHub sign-in is used for identity, draft pull requests, and GitHub Actions reads. The relay keeps GitHub access tokens server-side; desktop clients do not receive those tokens.

Each desktop install has a device identity used for encrypted invite approval and room-key delivery. The profile drawer shows the local device id and public key fingerprint. Resetting the device identity creates a new local device key, which can make other room members see the device as untrusted until they review the new fingerprint.

`Copy diagnostics` creates a local JSON bundle for bug reports. In the native app, capture-redacted warning/error entries are retained in an owner-only diagnostics file for up to seven days, 256 KiB, or 500 entries, whichever bound is reached first. The browser/web preview keeps diagnostics in memory only. Export validates and re-redacts stored entries; it is designed to exclude transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, and GitHub tokens. Review the bundle before attaching it to an issue.

## Teams, Rooms, And Search

The left sidebar contains teams, active rooms, room creation, GitHub sign-in, theme switching, search, and an archived view for archived teams and rooms.

Teams group related project rooms. A room is the collaboration space for one active project folder at a time. Search covers room names, project paths, room metadata, and decrypted-on-device local chat history for rooms whose local keys are available.

The team roster shows owner/admin/member roles. Owners can promote members, demote admins, remove non-owner members, and transfer ownership. Removing a member revokes future relay access, closes live sockets, and invalidates outstanding team invite metadata, but it does not erase content or keys that member already received.

Teams and rooms can be archived or deleted from the sidebar. Archiving moves rooms out of the normal sidebar into the archived view and keeps them restorable, but pauses normal room activity until restored. Deleting removes the team or room from the workspace for members going forward. It does not erase local copies, screenshots, copied Markdown, project files, or ciphertext already delivered to devices.

## Members And Device Trust

The Members panel shows live room presence, host status, device labels, and device key fingerprints.

`keyed` means a member has a public device key. `local trust` means this device has locally marked that exact room/device/fingerprint as expected. Trust is local-only; the relay does not enforce it, and other members do not inherit it. Copying a fingerprint lets people compare keys out of band.

## Chat

Room chat supports encrypted messages, replies, reactions, attachments, local edits, and local deletes. A user can edit or delete their own message only before that message has entered a started Codex turn. Once Codex consumes a message, post a follow-up correction instead.

Typing `@Codex` or clicking the Codex button proposes a Codex turn. If another proposal is pending or a turn is running, the request enters the room-visible Codex queue. Queued turns refresh against current chat until they start.

`/goal` sets a Codex thread goal after the room has an approved Codex thread. Goals use Codex Goal mode through app-server: Codex keeps the objective attached to the thread, and the app shows Codex-reported status such as active, paused, blocked, usage-limited, budget-limited, or complete. Pause, resume, edit, and clear actions update the Codex thread goal.

## Attachments

The host can attach project files to chat from the file editor. Small text/code previews can be embedded directly in encrypted chat payloads. Larger previews are encrypted locally, uploaded to relay blob storage as ciphertext, and opened from the file preview pane after local decryption.

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

## Host Handoff

Host handoff lets the active host pass continuity to another eligible member, including when the host hits Codex usage limits or needs to step away.

A handoff package can include recent-message counts, queued Codex turns, attachment names, terminal names, model, project path, Git repository metadata, dirty-file names, and an encrypted patch when small enough. The replacement host uses their own Codex access and attaches their own local project folder.

## Project Files And Diffs

The Project panel attaches the active host's local folder to the room. Room members can browse the shared project tree, open text file previews, inspect diffs, view Git status, and copy Markdown summaries while the room is unlocked. Project reads are bounded and room-scoped.

The file editor can open files, show diffs for changed files, expand into a larger view, attach the selected file to chat, and save edits back to disk. Active hosts can save directly. Other room members can edit and request a save; the active host must approve before the change touches disk. File previews and diffs are bounded; truncated files cannot be saved from the editor.

`Markdown` copies a project/file summary. `Summary` copies a changed-file summary. If clipboard access is blocked, the generated Markdown appears in an in-app fallback panel.

## Terminals

The Terminals panel manages room-scoped host-local terminals. The active host can open, type into, restart, close, and copy terminal output as Markdown.

Non-host members can request exact terminal commands. The active host sees the requester, command, working directory, and warnings before approving or denying. Approved requests run on the host account from the room's selected project folder; this is shell access on the host account, not a project sandbox.

Terminal output is visible to the room when shared through terminal request results, Codex events, copied Markdown, or approved context. Secret-looking commands and output get warnings, but hosts should review carefully.

## Browser

The Browser panel opens a room/project-scoped in-app browser surface on the active host's machine. It is not the host's normal Chrome profile.

The browser profile persists by default so signed-in sites can work inside that isolated room/project context. Hosts can reset the profile or use refresh mode, which clears the room/project browser profile before each approved open.

Browser opens requested by Codex or other room events go through the host approval boundary. The browser blocks downloads, page Clipboard API access, file inputs, and drag/drop uploads where the native platform allows it. Signed-in pages can still expose sensitive content to the room if the host shares or approves that context.

For sharing a running localhost web app through a public URL, see [local-preview-sharing.md](local-preview-sharing.md).

## Git And GitHub

Local Git workflows run on the active host's machine. The host can create a branch, commit, optionally push, and open a draft PR after reviewing the approval preview.

On the official hosted relay, GitHub sign-in is required. Local-only branch/commit workflows without GitHub sign-in may be available only on local/LAN or self-hosted relays configured without GitHub auth. Push, draft PR creation, and GitHub Actions refreshes require GitHub sign-in on a relay configured for GitHub OAuth with appropriate scopes.

The GitHub Actions panel reads workflow runs for the selected owner, repo, and branch. When the room has a GitHub `origin` remote, the app can infer owner/repo fields; the host can also edit them manually.

Git workflow progress and Actions refreshes are shared to the room as encrypted events so other members can follow branch, commit, push, PR, and CI status without the relay reading plaintext Git output.

## Invites And Room Keys

The Invites panel can copy a room invite, import an invite, enable host approval for joiners, approve or deny gated invite requests, and rotate the room key.

Direct invite links include the room key in the URL fragment for convenience. Gated invites do not include the room key; the joiner sends a device-sealed request to the active host, and approval delivers the room key wrapped to the joiner's device key.

Room-key rotation changes the key used for future room messages and invite links. It is useful after accidental invite sharing or routine hygiene, but it is not full cryptographic member removal in the alpha.

## Local History, Notifications, And Forgetting A Room

Local history is encrypted on the device and has a configurable retention window. It can include chat, workflow events, terminal snapshots, browser approvals, Codex events, Git events, GitHub Actions refreshes, host handoff packages, local previews, and Codex thread continuity.

Clearing local history removes saved local room history while keeping the room key. Forgetting a room on one device removes local history, local room settings, saved Codex thread id, the local room key, and warning acknowledgements. The room becomes locked on that device until a fresh invite or key is imported.

Room notifications can be muted per room. Muting affects local notifications/unread attention on that device; it does not mute the room for other members.

Team defaults control settings for newly created rooms, including local history retention, default approval policy, default model, browser profile persistence, and whether new room invites require host approval.

## Updates

The app checks the public release manifest and shows an in-app update banner when a newer version is available. Security updates get a stronger label. The alpha does not auto-update; users install signed builds manually from GitHub Releases.
