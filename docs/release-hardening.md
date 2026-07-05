# Release Hardening

multAIplayer alpha releases are security-sensitive because the desktop app can coordinate local project files, terminals, browser state, GitHub access, and a local Codex host. This checklist is for maintainers preparing public alpha artifacts or a hosted relay.

## Required Local Gates

Run these before tagging or publishing a release candidate:

```bash
npm run doctor
npm run verify
```

For an internet-facing relay, run the production relay doctor in the same environment used to start the relay:

```bash
npm run doctor:production-relay
```

The production relay doctor must pass before using an official hosted relay. It checks for GitHub OAuth, a strong durable session secret, explicit allowed origins, auth-required mode, disabled debug endpoints, and disabled demo seeding.

## Release Artifacts

The current GitHub release workflow builds unsigned macOS artifacts and writes `SHA256SUMS.txt`. Until signing and notarization are configured, every release note must clearly state:

- the app is unsigned and not notarized;
- macOS Gatekeeper may require manual approval;
- users should prefer test/self-hosted rooms before using private projects;
- checksums are provided for integrity checking, not as a substitute for signing.

Do not attach ad hoc local builds to public releases. Release artifacts should come from GitHub Actions so the source commit, workflow logs, and checksums are visible.

## Secrets

Release workflows and logs must not expose:

- GitHub OAuth client secrets;
- GitHub access tokens;
- OpenAI or Codex credentials;
- direct room-key invite fragments;
- decrypted room payloads;
- private repo files, diffs, or terminal output.

The current release workflow does not need OpenAI credentials because Codex runs through the user's local Codex app-server, not through the OpenAI API.

## Before A Non-Alpha Release

Before presenting multAIplayer as production-ready, the project should add:

- Apple Developer ID signing and notarization;
- documented maintainer release key custody;
- stronger member-removal key epochs;
- database-backed relay storage and backup/restore drills;
- external or shared-store rate limiting for multi-instance relays;
- private security contact and disclosure process;
- end-to-end multi-device invite, removal, and recovery tests.
