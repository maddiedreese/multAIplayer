# Next Alpha Release Notes

These notes are a draft for the next public alpha after `v0.1.0-alpha.0`. Keep them updated until the release tag is cut, then copy the final version into the GitHub Release body.

## Highlights

- Desktop app structure was refactored from a single large `App.tsx` into feature-sized components, hooks, and shared UI helpers so future contributors can work in smaller files.
- The desktop experience now more closely follows the intended Codex-style workspace: normal room chat in the center, collapsible side panels, room-scoped files, diffs, terminal, browser, model, host, and handoff controls.
- File attachments from Codex messages can open the full file viewer instead of acting like inert chips.
- The in-app browser behaves like a room tool instead of a browser-approval workflow. It has a URL bar and can be opened by Codex-triggered room events such as asking Codex to open a localhost preview.
- Terminal UX has been tightened toward an actual room shell: foreground terminal state, copy-as-Markdown support, and clearer empty/error states.
- Host handoff now has an alpha path for Codex usage exhaustion: the room can mark the current host as limited, another eligible member can accept hosting, and the replacement host receives reconstructed room context.
- Local preview sharing was added so a host can expose a local development server through room context during collaborative coding.
- Release hardening now includes production relay checks, branch protection, stronger issue templates, signed/notarized macOS release enforcement, and clearer alpha launch documentation.

## Security And Privacy Notes

- The relay still routes encrypted room traffic and must not receive plaintext room transcripts, attachments, Codex credentials, OpenAI credentials, repo contents, terminal output, or browser contents.
- GitHub OAuth tokens stay on the relay. When `MULTAIPLAYER_RELAY_SESSION_SECRET` is configured, durable GitHub sessions are encrypted before being written to the alpha relay store.
- The active Codex host still controls local project, terminal, browser, Git, GitHub, and Codex access for a room.
- Browser, terminal, private repo, signed-in web page, `.env`, credential, and secret-output warnings remain part of the alpha trust model. Users should assume host-visible local tool context can be sensitive.

## Known Alpha Limitations

- Public macOS alpha artifacts are expected to be Developer ID signed and notarized. Local development builds are not release artifacts and may be unsigned.
- Member removal does not yet provide production-grade cryptographic key epochs.
- The official/self-host relay uses SQLite table storage in this alpha. It still needs backup/restore drills and external/shared rate limiting before production claims.
- Rate limiting is process-local.
- Host handoff reconstructs context from room state; it still needs real two-person testing against actual Codex usage-limit failures.
- Browser and terminal behavior is powerful and intentionally host-local, but it should continue to receive security review before private or regulated work.

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
- Send encrypted messages and attachments.
- Invoke Codex, approve a turn, and inspect the file/diff output.
- Open a browser preview from the browser tab and from a Codex instruction.
- Type in a terminal, copy Markdown, and restart the terminal.
- Create a branch, commit, push, open a draft PR, and refresh Actions.
- Simulate or trigger usage exhaustion and accept host handoff on the second device.
