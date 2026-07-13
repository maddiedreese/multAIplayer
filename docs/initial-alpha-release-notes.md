# Initial Alpha Release Notes

These notes describe the public alpha release. Copy the final version into the GitHub Release body when the release tag is cut.

## Highlights

- Feature-sized desktop components, hooks, and shared UI helpers keep the codebase approachable for contributors.
- The desktop workspace centers normal room chat with collapsible panels for room-scoped files, diffs, terminals, browser, model selection, host controls, and handoff.
- File attachments from Codex messages open in the file editor when available.
- The in-app browser is a room tool with a URL bar and host-approved opens from room events, including localhost preview requests.
- Terminal rooms support foreground terminal state, copy-as-Markdown, and explicit empty/error states.
- Host handoff supports Codex usage exhaustion: the room can mark the active host as limited, another eligible member can accept hosting, and the replacement host receives reconstructed room context.
- Codex turns use a bounded room-visible queue, encrypted queue persistence, and consumed-message tracking. Queued turns refresh against current chat, while started turns freeze the messages that entered Codex context.
- Chat supports encrypted replies, local pre-Codex edits/deletes with tombstones, and encrypted local-history audit records for those mutations.
- Codex goals can be started with `/goal` after a room has an approved Codex thread; pause, resume, edit, and clear actions update Codex thread goal state through app-server.
- Local preview sharing lets a host expose a local development server through room context during collaborative coding.
- Release hardening includes production relay checks, branch protection, issue templates, signed/notarized macOS release enforcement, and alpha launch documentation.
- The desktop app shows an in-app update banner from the public alpha release manifest, with a stronger label for security updates.
- Account settings can save a re-redacted local diagnostics bundle for bug reports. Rust assembles and writes the native bundle through the system save dialog without returning prior-session entries or bundle contents to the webview. The native app retains bounded capture-redacted warning/error metadata in an owner-only app-log file for up to seven days, 256 KiB, or 500 entries; the web preview remains memory-only and can copy its current-session bundle. The bundle is designed not to include transcripts, room secrets, terminal output, browser contents, file contents, invite fragments, or GitHub tokens.

## Security And Privacy Notes

- Protocol v2 replaces the custom room-key and envelope design with RFC 9420 MLS through `mls-rs`. The native Rust core owns credentials, group state, commits, encryption, exporters, and retained history secrets; no raw group secret crosses into the webview.
- Exactly one ciphersuite is accepted: `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`. Both clients and the relay enforce active-host-only commits, and the relay atomically serializes one commit per expected epoch.
- The relay routes encrypted room traffic and must not receive plaintext room transcripts, attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, or browser contents.
- Local history remains readable across MLS epochs by deliberate policy: per-epoch exporter-derived history secrets are retained in encrypted native storage. Live traffic gains MLS forward secrecy and recovery properties, but retained local history does not.
- GitHub OAuth tokens stay on the relay. When `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured, durable GitHub sessions are encrypted before being written to the alpha relay store.
- The active Codex host controls local project, terminal, browser, Git, GitHub, and Codex access for a room.
- Browser, terminal, private repo, signed-in web page, `.env`, credential, and secret-output warnings remain part of the alpha trust model. Users should assume host-visible local tool context can be sensitive.

## Known Alpha Limitations

- Public macOS alpha artifacts are Developer ID signed and notarized. Local development builds are not release artifacts and may be unsigned.
- This is a clean protocol-v2 break. Rooms, ciphertext, local cryptographic state, and invite links created before v2 are not migrated and are unreadable or invalid. Create a new room and invite instead.
- The browser/web preview is now a seeded local UI demonstration. Creating, joining, or exercising E2EE rooms requires the native desktop app.
- Member removal revokes relay access and outstanding invites before the host issues MLS Remove commits. Content and retained history already delivered cannot be erased.
- A device that loses or corrupts its MLS state must rejoin and cannot recover pre-rejoin backlog or history secrets.
- The official/self-host relay uses SQLite table storage in this alpha. It needs backup/restore drills and external/shared rate limiting before production claims.
- Release preflight includes a fixture SQLite backup/restore drill and dependency license scan; maintainers should also run the SQLite drill against a staged copy of the real relay store before tagging.
- Rate limiting is process-local.
- Host handoff reconstructs context from room state and requires real two-person testing against actual Codex usage-limit failures before broader promotion.
- Browser and terminal behavior is powerful and intentionally host-local; use private or regulated work only after an appropriate security review.
- Native diagnostics are not encrypted at rest in this alpha. They are bounded, capture-redacted, owner-readable metadata and are re-redacted during export; revisit encryption before collecting richer diagnostic content.

## Upgrade And Test Notes

Before publishing:

```bash
npm run release:preflight
```

For the official relay environment:

```bash
NODE_ENV=production npm run doctor:production-relay
```

Recommended manual smoke test:

- Sign in with GitHub.
- Join through an invite link on a second machine/account.
- Approve the KeyPackage-based invite and verify Welcome join.
- Send MLS-encrypted messages and exporter-keyed attachments.
- Invoke Codex, approve a turn, and inspect the file/diff output.
- Open a browser preview from the browser tab and from a Codex instruction.
- Type in a terminal, copy Markdown, and restart the terminal.
- Create a branch, commit, push, open a draft PR, and refresh Actions.
- Remove a member and verify they cannot decrypt the next epoch.
- Simulate or trigger usage exhaustion, request host handoff on the second device, approve it on the outgoing host, and verify messaging continues.
