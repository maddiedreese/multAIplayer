# Frequently Asked Questions

## Positioning

### How is this different from VS Code Live Share, tmux sharing, or just screen-sharing on a call?

Those tools primarily share an editor, terminal, desktop, or live view. multAIplayer creates a persistent project room around a locally hosted Codex session.

The room brings together team chat, selected project files, diffs, terminals, browser context, Git workflows, Codex activity, approvals, and host handoff. Teammates can propose Codex turns and local actions without receiving unrestricted remote control of the host's computer. The active host reviews requests and controls what may execute locally.

It is not a replacement for every Live Share, tmux, or screen-sharing workflow. It is specifically designed for a team collaborating with an AI coding agent while keeping one person's machine and credentials behind an explicit authority boundary.

### Who is this actually for?

multAIplayer is for small, trusted teams that want to pair with Codex together.

That may be two developers working through a feature, a small product team reviewing an agent's work, or collaborators who want one shared conversation around code, tools, and decisions. It assumes that room members are trusted participants, because admitted members can see shared project context and request actions involving the active host's project, terminal, browser, Git, GitHub, and Codex session.

It is not designed as an anonymous public chat service, a large enterprise collaboration platform, or a way to let untrusted users operate someone else's computer.

### What happens the first time I open the app?

The setup guide asks whether you want to create an encrypted workspace and first room or join one with an invite. It then checks relay connectivity, GitHub identity requirements, the local Codex installation, ChatGPT authorization for Codex, and project-folder readiness. GitHub identifies collaborators and enables repository workflows; ChatGPT authorizes Codex on the local host device. They are separate accounts. Creating requires the device to be ready to host Codex; joining blocks only on relay and GitHub identity, so an invitee can install or authorize Codex later. When a sign-in started from this readiness screen succeeds and clears the final blocker, setup advances to the create or join form automatically. It never accepts an invitation, requests device admission, creates a workspace, or starts Codex without the user's next explicit action.

You can explore without finishing, save and close, or reopen/restart setup from Help. A five-item sidebar checklist remains available until its milestones are complete or you dismiss it. The first-turn guide runs inside the real room and does not automatically send a starter prompt or approve Codex.

Onboarding progress stays on the device. It stores bounded identifiers and completion flags, not invite links, project paths, form values, prompts, project content, account details, or secrets. There is no tutorial telemetry. If a step fails, the guide stays at a recoverable state: it can retry relay or Codex checks, reopen account sign-in, retry folder selection, resume room creation without duplicating an already-created team, or wait for host device approval on an invite.

### What happens when I click an invitation link?

Official invites are HTTPS universal links, not a custom app scheme. All invitation material is in the fragment after `#`, so neither `open.multaiplayer.com` nor `multaiplayer.com` receives it in the landing-page request. A correctly signed, installed macOS release can receive the link through Apple's associated-domain mechanism. The native app validates the host, path, absence of query/credentials/port, exact fragment fields, bounds, and base64url alphabets before showing a content-free **Invitation received securely** status.

The same static page offers a download only when the release manifest identifies a supported signed DMG. No supported public build has been published yet. The page keeps a valid original link only in memory long enough for an explicit cross-host retry; it never stores or renders the capability. After installing a supported release into Applications, select **Open multAIplayer**; if the browser still does not hand off, return to the original private message and click the link again. Refresh or navigation deliberately loses the in-memory link. The project does not use cookies, local/session storage, analytics, automatic clipboard access, or a `multaiplayer:` fallback for this journey.

Universal-link routing is an operating-system and signed-release boundary. Parser, AASA-shape, entitlement-presence, static-page, cold-start intake, and already-running intake code have automated tests, but each release still needs a manual signed-app cold/warm click check against the live AASA files and real Apple Team ID.

### How do GitHub and ChatGPT sign-in differ?

GitHub Device Flow identifies the workspace member. The native app shows a short code, opens GitHub in the system browser, polls for completion, and stores the token in macOS Keychain. It sends the token once over TLS so the relay can verify the GitHub identity, after which the relay discards it. ChatGPT authorizes the local Codex app-server and can use a browser or device-code flow; its credentials remain under Codex's local credential management. The assistant displays both flows in place, but does not persist their codes, URLs, login ids, or account details.

Provider URLs are checked twice before native navigation: TypeScript accepts only the expected HTTPS GitHub or OpenAI hosts, and Rust independently repeats the provider-specific validation before using the operating system's default-browser opener. A browser-open failure leaves an explicit copy-link fallback rather than silently stranding setup.

## Trust and security

### Why do you use MLS instead of custom cryptography or Matrix?

Protocol v2 uses RFC 9420 Messaging Layer Security through the Rust `mls-rs` implementation. MLS supplies the group key schedule, authenticated membership changes, sender authentication, epoch binding, and application-message protection. multAIplayer deliberately restricts MLS's broader commit model so only the active host may commit membership or host-authority changes.

The original alpha protocol used custom epoch keys and per-device wrapping. It was removed rather than extended with selected MLS-like pieces because a partial implementation would not inherit MLS security properties. Matrix would introduce a much broader federated messaging, identity, and server-state architecture than this product currently needs.

Using a maintained MLS implementation reduces the application-owned cryptographic surface, but it does not make this integration audited. The host-authority rules, invite HPKE flow, authenticated context, native IPC boundary, and encrypted storage integration remain multAIplayer policy and code. Read [Cryptography architecture](cryptography.md), the [MLS protocol v2 decision](decisions/mls-protocol-v2.md), and the [Threat model](threat-model.md) for the exact boundaries.

### What can the relay see about me and my project?

The relay can see the metadata it needs for authentication, membership, routing, limits, and operations. This includes information such as:

- GitHub user identifiers and basic profile information used for sign-in
- Team and room identifiers and names
- Membership, roles, host status, and live presence
- Device identifiers, registered public keys, and public-key fingerprints
- Relay-visible approval and browser-policy settings
- Invite identifiers, expiration data, and other invite metadata
- MLS message classes, sender and device identifiers, timestamps, epoch hints, and opaque message sizes
- Attachment blob names, MIME types, declared sizes, epochs, expiration data, and storage usage; blob contents remain sealed
- Operational counters, rate-limit data, request identifiers, and connection information

The relay is designed not to persist plaintext room messages, attachment contents, project files, host-local project paths, Codex model/tuning configuration, file diffs, terminal output, browser contents, Codex credentials, OpenAI credentials, MLS private state, group secrets, exporter output, retained history secrets, or GitHub access tokens. The native app stores the GitHub token in macOS Keychain and calls GitHub directly for pull requests and Actions. The relay observes the token only during sign-in identity verification and immediately discards it. Authorized teammates can see GitHub display identity, avatar, device labels, and public device fingerprints in presence and roster surfaces.

This is an intended and tested architecture boundary, not an independently audited guarantee. See the [Threat model](threat-model.md) for the detailed inventory.

The [Privacy Policy](https://multaiplayer.com/privacy) gives the hosted-service inventory and the [Terms of Service](https://multaiplayer.com/terms) covers the free open-source alpha's acceptable-use and service terms.

### Do I have a multAIplayer account, and can I delete it?

There is no separate multAIplayer username or password. On the official relay, your hosted account is the GitHub identity you authorized together with relay sessions, registered devices and KeyPackages, team memberships, and invite/admission records.

The Account drawer provides **Delete hosted account data**. It requires an exact confirmation phrase and blocks deletion until you transfer or delete teams you own and hand off rooms you host. Successful deletion removes your relay auth/device sessions, devices, KeyPackages, memberships, and pending invite artifacts. It cannot retract shared team/room records, opaque MLS ciphertext, encrypted attachment blobs, or accepted receipts already relied on by other room members. Local encrypted room data is separate; use each room's **Forget on this device** action before deleting the hosted account if you also want to remove that Mac's room copy.

### If I invite someone to a room, what exactly can they make happen on my machine, and what requires my approval?

An admitted room member can participate in encrypted chat and see the project context intentionally shared with the room. Depending on the room state, that can include project structure, bounded file previews, diffs, Git status, Codex activity, terminal snapshots, browser decisions, and workflow events.

A member can also propose actions, including:

- Invoking Codex with room context
- Requesting an exact terminal command
- Editing a shared file and requesting that it be saved
- Requesting a browser open
- Requesting Git branch, commit, push, pull request, or related workflow actions
- Proposing work that may cause Codex to request tools or local changes

These proposals do not give the member direct remote-control access. Codex turns, non-host file saves, terminal commands, browser opens, and Git or GitHub mutations require active-host authorization before touching the host machine. Native safety controls add filesystem containment, command review, secret-pattern redaction, and stronger confirmation for recognized credential access.

Approval remains a meaningful security decision. A terminal command or Codex turn approved by the host can still read, modify, execute, or transmit data within the capabilities granted to it. Warnings and secret detection reduce accidental exposure but cannot identify every dangerous command or secret. See [Using the app](using-the-app.md) and [Alpha limitations](alpha-limitations.md).

### Are invite links safe to paste into Slack or Discord? What happens if one leaks?

Treat a complete invite link as a private bearer secret.

The link does not contain an MLS group secret. It contains a randomly generated, single-use capability and a public binding to the active host's identity and HPKE key. Someone who obtains the complete link can submit a request bound to one exact device KeyPackage, but they cannot join the MLS group until the active host verifies the request and creates an Add Commit and one-shot Welcome.

It is reasonable to send a link through a private direct message or restricted channel whose participants you intend to invite. Do not paste it into public channels, issue trackers, logs, support tickets, or searchable documentation.

If a link leaks, do not approve an unexpected request. Invalidate the invite and generate a new one. Membership changes also invalidate outstanding invites. A leaked invite capability does not reveal existing room content by itself, but it creates an unauthorized opportunity to request access.

### Has the encryption been audited?

No. The cryptographic protocol and implementation have not received an independent professional security audit.

The repository includes documented protocol boundaries, generated MLS membership/host-transition tests, adversarial Commit ordering/replay tests, RFC 9180 HPKE known-answer evidence, lifecycle and persistence tests, relay commit-ordering and KeyPackage-consumption tests, production-path parser fuzzing, focused invite-authenticator mutation testing, and a public threat-model changelog. There is also a curated [External review packet](external-review-packet.md) that identifies the protocol, implementation boundaries, invariants, test commands, and areas where review would be most useful.

Those controls improve reviewability and catch regressions. They do not replace an independent audit or establish that the system is secure against every real-world attack.

Cryptographers and protocol reviewers can help by using the external review packet, reviewing the MLS lifecycle, host-authority policy, invite bindings, storage transactions, and native secret boundary, and reporting findings through [GitHub private vulnerability reporting](https://github.com/maddiedreese/multAIplayer/security/advisories/new) or the private contact in [SECURITY.md](../SECURITY.md).

## Scope and platform

### Why Codex only? Will you support Claude Code, Aider, or other agents?

The current product is built around the local Codex app-server. Its thread, turn, goal, model, approval, authentication, app, and MCP APIs provide the structured lifecycle that multAIplayer exposes to a room.

This is deeper than sending prompts to a command-line process. The app tracks Codex threads, reconstructs bounded room context, handles bidirectional approvals, presents model and reasoning controls, records safe lifecycle events, and supports host handoff around that specific contract.

We are open to exploring Claude Code, Aider, and other agents. There is no committed integration or timeline. Supporting another agent responsibly would require a well-defined local protocol for turns, approvals, tools, cancellation, activity, authentication, and context handling. It would also require new compatibility fixtures, security boundaries, and tests rather than a thin command wrapper.

### Why is it macOS-only, and when do Windows and Linux land?

macOS is the sole supported release target for the public alpha.

The native desktop app relies on platform-sensitive behavior including Tauri and WebView integration, Keychain storage, process containment, terminal handling, browser profiles, Developer ID signing, notarization, and Gatekeeper verification. Supporting a platform means validating those security and lifecycle boundaries, not only producing a binary that launches.

Linux is used as a development and CI compatibility target in parts of the project, but Linux desktop packages are not supported or published. Windows packages are also not configured or published.

The supported alpha package is Apple silicon only and requires macOS 11 or later. Intel Macs, Windows, and Linux are not supported, and there is no committed timeline for them. The immediate priority is making the Apple silicon alpha reliable enough to validate the product, security model, and real multi-device workflow.

### Why do you only support Codex 0.133 through 0.144, and what happens on newer versions?

multAIplayer depends on the Codex app-server protocol, which can change as Codex evolves. The project has generated schema fixtures and compatibility tests for versions 0.133.0, 0.143.0, and 0.144.0, with 0.133.0 through 0.144.0 treated as the supported range.

Older versions cannot host a room because required methods or contract shapes may be missing. Newer versions are labelled unverified. Contract-sensitive or security-sensitive features fail closed when the app cannot establish that the server behavior is compatible.

A scheduled compatibility job installs the latest Codex CLI, generates its schema, compares it with the supported baseline, starts the real app-server, performs its initialization handshake, and exercises model discovery. A passing forward-compatibility check provides evidence for review, but it does not automatically expand the supported range. The documented range changes only after the new version has been deliberately evaluated and its fixtures and tests have been updated. See [Codex hosting](codex-hosting.md).

### Why GitHub-only sign-in?

GitHub currently serves two related purposes: room identity and the project's built-in GitHub workflow.

The native app uses GitHub Device Flow to identify users, then the relay verifies that identity and creates a token-free session for team and room access. The native Rust boundary also creates draft pull requests and reads GitHub Actions without exposing the access token to the webview or relay proxy. The alpha grant is `read:user repo`: `read:user` provides identity, while GitHub's broad `repo` scope covers both public and private repositories the signed-in user can access.

Using one provider keeps the alpha's identity, authorization, PR, and Actions surfaces small enough to review and operate. It also matches the current audience of software teams working in Git repositories hosted on GitHub.

GitHub-only sign-in is an alpha scope decision, not a claim that every future deployment must use GitHub. Other identity providers and a GitHub App model are possible future directions, but neither is required or committed for the initial alpha. A private local or LAN relay can explicitly disable authentication, but that mode is not appropriate for an internet-facing relay.

## Architecture and operations

### What happens when the active host goes offline mid-session?

The active host's local capabilities stop being available. New Codex turns, terminal commands, file saves, browser opens, and Git mutations cannot execute on that machine. In-flight local work may fail or require the original host to reconnect and retry.

Room members with current native MLS state can continue using encrypted chat and reading locally available history. The relay does not take over the host's Codex session, project folder, terminal processes, browser state, or credentials.

multAIplayer supports explicit host handoff. A replacement host uses their own machine, Codex access, credentials, and local project checkout. The handoff can carry encrypted continuity information such as repository identity, branch, bounded project state, selected model, approval policy, recent room context, attachments, terminals, and a bounded Git patch where available.

There is no transparent machine failover. An abrupt disconnect may not produce a complete handoff package, and live terminal processes or unsaved host-local state are not transferable. Normal Git commits, branches, backups, and clean handoffs remain the reliable continuity path.

### Can I self-host the relay, and why does a custom relay URL require rebuilding the desktop app?

Yes. The relay is open source and can be self-hosted.

An internet-facing deployment should use HTTPS and WSS, exact allowed origins, GitHub authentication, persistent SQLite storage, hashed session identifiers at rest, rate limits, quotas, backups, health checks, monitoring, and the included production-relay doctor.

The origin allowlist is a browser CORS and WebSocket-origin control, not client authentication. Native and server-side requests may omit `Origin` and are allowed for that reason, so authenticated sessions, device signatures, membership checks, and TLS remain necessary.

Official desktop builds pin the hosted relay endpoints and restrict network access through the Tauri application's Content Security Policy. They do not permit arbitrary HTTPS or WebSocket destinations, and they hide relay editing. This prevents a compromised setting, injected page, or casual configuration change from redirecting the trusted desktop shell to an unexpected server.

A custom relay therefore requires a self-built desktop whose allowed HTTP and WebSocket origins are included at build time. That is less convenient, but it keeps the packaged application's network authority explicit and reviewable. See [Self-hosting](self-hosting.md).

### What happens to my data if the hosted relay or the project shuts down?

Your project folder, Git repository, branches, commits, native MLS state, retained history secrets, and encrypted local history are not owned by the relay. They remain on the relevant devices.

The relay does hold routing and membership state, encrypted backlog, encrypted attachment blobs, invites, and sessions. Moving to another relay recreates teams, rooms, memberships, sessions, and invites. It does not automatically transfer hosted backlog or encrypted attachment blobs, and the destination relay cannot reconstruct device-local keys or history.

Before depending on the alpha for important work:

- Keep normal project and Git backups
- Push important branches to a remote
- Export important room conversations to Markdown
- Save important attachments outside relay storage
- Keep every device that contains needed MLS state, retained history secrets, and encrypted history
- Test self-hosting before an emergency
- Do not clear or reinstall an original device until migration is verified

The planned hosted-relay shutdown policy provides at least 30 days of public notice and migration access when safely possible. Security, legal, provider, or data-exposure emergencies may require a shorter period.

The repository remains available under Apache-2.0 if maintenance stops, but there is no promise that hosted infrastructure, future operating-system compatibility, or upstream Codex and GitHub compatibility will continue indefinitely. Read [If this project goes unmaintained](if-unmaintained.md) for the complete exit path.

## Practical

### Is this safe to use on a private or work repository yet?

Probably not yet, unless your team has reviewed the risks and decided the current alpha controls are appropriate for that repository.

The encryption is unaudited. Room membership grants access to meaningful project context. Approved Codex turns and terminal commands can affect the host's files and accounts. Signed-in browser pages, terminal output, private paths, diffs, copied Markdown, and local tools can expose sensitive information. Warnings and redaction are safeguards, not complete data-loss prevention.

The safer evaluation path is:

1. Use a disposable or public test repository with no production secrets.
2. Use a separate branch and keep a clean remote backup.
3. Start with two trusted people and a newly created room.
4. Use dummy credentials and test accounts where possible.
5. Keep browser sessions free of sensitive accounts.
6. Review every approval and avoid broad shell commands.
7. Test member removal, MLS epoch changes, host handoff, relay restart, and local export.
8. Prefer a test or self-hosted relay while evaluating the trust model.
9. Read the [Threat model](threat-model.md) and [Alpha limitations](alpha-limitations.md) before introducing private code.

Private, regulated, customer-sensitive, or high-stakes repositories should wait for stronger dogfooding, external cryptographic review, operational maturity, and an organization-specific security assessment.

### What does alpha mean concretely? What is most likely to break?

Alpha means the core product exists and is tested, but its compatibility, recovery, operations, and multi-device behavior are still being validated under real use.

The most likely failure areas are:

- A newer Codex version changing the app-server contract
- Host handoff losing some live or uncommitted local context
- A host disconnect interrupting Codex, terminal, browser, or Git work
- Relay configuration, OAuth, TLS, persistence, backup, or restart mistakes
- Room-key and history recovery after reinstalling, forgetting a room, or losing a device
- Browser and terminal behavior varying across native WebView and operating-system conditions
- Local preview tunnels ending or exposing a temporary URL more broadly than intended
- Large or long-lived relays reaching the limits of single-instance SQLite storage and process-local rate limiting
- Manual update installation and compatibility transitions between alpha builds
- UI issues involving resizable panels, embedded browser behavior, accessibility, or multi-device state races
- Warnings failing to recognize an unusual secret, credential path, or dangerous command
- Features working in automated tests but failing during real two-account, two-device use

The alpha should be treated as security-sensitive development software. Keep recoverable copies of important work, expect occasional resets or manual recovery, and report reproducible problems using dummy data and the project's bounded diagnostics tools.
