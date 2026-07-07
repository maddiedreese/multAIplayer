# Official Relay Deployment Checklist

Use this checklist for the `multAIplayer.com` hosted relay. It is stricter than local self-hosting because users will treat the official relay as the default trust boundary.

## Decisions To Make First

- Public app origin, likely `https://multaiplayer.com`.
- Relay HTTP API origin, for example `https://relay.multaiplayer.com` or the same origin behind `/api`.
- Relay WebSocket URL, for example `wss://relay.multaiplayer.com/rooms`.
- GitHub OAuth app owner and callback/verification details.
- Hosting provider and whether the alpha starts as one instance or a multi-instance deployment.
- Whether the macOS alpha remains unsigned or uses Apple Developer ID signing and notarization.

## Required Environment

Set these in the same production environment that starts the relay:

```bash
NODE_ENV=production
PORT=4321
GITHUB_CLIENT_ID=...
GITHUB_OAUTH_SCOPES="read:user public_repo"
MULTAIPLAYER_RELAY_SESSION_SECRET=...
MULTAIPLAYER_RELAY_STORAGE=sqlite
MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
MULTAIPLAYER_RELAY_ALLOWED_ORIGINS=https://multaiplayer.com
MULTAIPLAYER_RELAY_REQUIRE_AUTH=true
MULTAIPLAYER_RELAY_DEBUG=false
MULTAIPLAYER_RELAY_STRUCTURED_LOGS=true
MULTAIPLAYER_RELAY_SEED_DEMO=false
MULTAIPLAYER_RELAY_RATE_LIMITS=true
MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false
```

Use `GITHUB_OAUTH_SCOPES="read:user repo"` only if the official alpha is intentionally asking for private repository PR access. The narrower `read:user public_repo` scope is the better default for a public open-source alpha.

Generate the session secret with a password manager or:

```bash
openssl rand -base64 32
```

Keep the value stable. Rotating it signs users out because stored GitHub sessions can no longer be decrypted.

## Production Doctor

Run this in the deployed environment before pointing users at the relay:

```bash
NODE_ENV=production npm run doctor:production-relay
```

The check must pass. It verifies GitHub OAuth presence, strong durable session encryption, exact HTTP(S) allowed origins, auth-required mode, disabled debug endpoints, disabled demo seeding, enabled rate limits, persistent relay storage, and conservative proxy-header handling.

## Storage And Backups

- Mount persistent storage outside the container filesystem.
- Do not use `/tmp` for `MULTAIPLAYER_RELAY_DATA_PATH`.
- Use `MULTAIPLAYER_RELAY_STORAGE=sqlite` for the official hosted alpha relay.
- Back up the relay SQLite store before deploys and before any migration.
- Treat the SQLite relay store as alpha infrastructure. Plan backup/restore drills, migration rehearsals, and shared/external rate limiting before production claims or multi-instance hosting.

## Network And Proxy

- Terminate TLS before the relay or run the relay behind a platform that provides HTTPS/WSS.
- Ensure WebSocket upgrades reach `/rooms`.
- Restrict CORS and WebSocket browser origins to exact bare origins such as `https://multaiplayer.com`.
- Do not use `*`, path-scoped origins, query strings, fragments, credentials, or non-HTTP(S) origins in `MULTAIPLAYER_RELAY_ALLOWED_ORIGINS`.
- Keep `MULTAIPLAYER_RELAY_TRUST_PROXY_HEADERS=false` unless a trusted reverse proxy strips client-supplied forwarding headers and writes its own.
- If the relay runs behind a trusted proxy and `TRUST_PROXY_HEADERS=true`, add provider documentation to the deploy notes explaining why spoofed forwarding headers cannot reach Node.

## Health Checks

- Use `/healthz` for container health.
- Use `/readyz` for platform readiness.
- Use `/metrics` for content-free relay counters such as active sockets, published envelopes, rate-limit rejections, start time, and uptime.
- Do not treat these endpoints as a privacy or security audit.

## Launch Smoke Test

Before announcing the relay:

- Start with a clean browser/device session.
- Sign in with GitHub.
- Confirm the app reports encrypted-at-rest relay sessions.
- Create a team and room.
- Invite a second GitHub account on a second device.
- Send messages and encrypted attachments.
- Confirm the relay store does not contain plaintext transcripts, attachment plaintext, repo files, terminal output, Codex credentials, OpenAI credentials, or plaintext GitHub tokens.
- Invoke Codex, approve a turn, and verify host-local project/browser/terminal access stays on the host device.
- Confirm rate-limited requests return `429` with `Retry-After`.
- Restart the relay and confirm signed-in sessions survive only when the session secret is stable.

## Rollback Plan

- Keep the previous deploy artifact available.
- Keep the previous relay JSON store backup available.
- If auth, storage, or WebSocket routing breaks, disable the official relay link in public copy and direct users to self-hosting until fixed.
- If plaintext leakage is suspected, stop the relay, preserve logs/store for private investigation, and use the security disclosure path instead of a public issue.
