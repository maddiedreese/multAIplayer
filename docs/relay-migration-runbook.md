# Hosted-To-Self-Hosted Relay Migration Runbook

This runbook is for a team that currently uses the hosted multAIplayer relay and wants to continue on a self-hosted relay. The relay routes encrypted envelopes, presence, invites, GitHub sign-in sessions, and encrypted blob storage; room keys and local room history stay on each device. A relay move therefore recreates relay-side team and room membership, while each device carries its own room keys and local history forward.

Use this for planned migrations, hosted relay outage recovery, and any hosted relay sunset window.

## What Carries Over

Carries over on each device:

- room keys already saved on that device;
- encrypted local room history retained on that device;
- local trust decisions and room settings saved by the desktop app;
- host-side Codex state that exists locally on the active host.

Must be recreated on the new relay:

- GitHub sign-in session for the new relay origin;
- team and room records;
- relay membership roster;
- invite metadata;
- encrypted reconnect backlog and attachment blobs that only existed on the old relay.

The relay never holds plaintext transcripts or room keys, so there is no server-side plaintext export to move.

## Before You Start

Pick a short quiet window where all active room members can open the desktop app. Ask members to avoid posting new chat messages, uploading attachments, or starting Codex turns until the migration is complete.

Choose the self-hosted URLs:

```text
Relay HTTP API URL: https://relay.example.com
Relay rooms WebSocket URL: wss://relay.example.com/rooms
```

The official packaged alpha desktop app-shell CSP allows localhost development relays and the hosted multAIplayer relay origin. Before using a custom relay origin in the packaged app, build a desktop app with `apps/desktop/src-tauri/tauri.conf.json` updated so `connect-src` includes both the self-hosted HTTPS relay origin and its WSS rooms origin. Otherwise the Settings change will be saved locally but browser CSP will block the app-shell requests.

Back up every device's local state by leaving the app installed and the rooms visible before changing relay settings. Encrypted room export/import is planned as the belt-and-suspenders backup path; until that exists, the practical backup is each member's retained local encrypted history plus normal project/Git backups.

## 1. Stand Up The Self-Hosted Relay

Follow [self-hosting.md](self-hosting.md) to deploy the relay with HTTPS/WSS, GitHub OAuth, persistent storage, exact allowed origins, durable encrypted sessions, and rate limits.

For Docker deployments, build from the repository root:

```bash
docker build -f apps/relay/Dockerfile -t multaiplayer-relay:alpha .
```

Run the production relay doctor in the same environment that will start the relay:

```bash
NODE_ENV=production npm run doctor:production-relay
```

The check must pass before inviting the team to switch. Also confirm:

- `https://relay.example.com/healthz` responds through the public HTTPS endpoint;
- `https://relay.example.com/readyz` responds ready before cutover;
- during a test restart, `/readyz` becomes not-ready, new HTTP/WS work is rejected, existing room WebSockets close with `1012`, and the relay store flushes before exit;
- WebSocket upgrades reach `wss://relay.example.com/rooms`;
- the relay data path is persistent and backed up;
- the relay logs do not include plaintext room content, attachment content, terminal output, browser pages, Codex credentials, OpenAI credentials, or repo files.

## 2. Create The Workspace On The New Relay

On the device that will coordinate the migration, using a desktop build whose CSP allows the self-hosted relay origins:

1. Open multAIplayer.
2. Open `Settings`.
3. In `App server / relay`, set `HTTP API URL` to the new HTTPS relay URL.
4. Set `WebSocket rooms URL` to the matching WSS `/rooms` URL.
5. Click `Save relay`.
6. Sign in to GitHub again if prompted. GitHub sessions are scoped to the relay origin.
7. Create the team and room records that should exist on the new relay.

Use the same human-readable team and room names when possible. The new relay will assign fresh relay-side ids; the continuity source of truth is each member's local room key/history plus the new invite or approval flow.

## 3. Re-Invite Members

For each member and device:

1. Keep the old room available locally until the member has joined the replacement room.
2. Generate a fresh invite from the new self-hosted relay room.
3. Prefer gated/no-secret invites when an active host is available.
4. Have the member open the invite, switch their Settings relay URLs to the self-hosted relay, and join.
5. Confirm the member can send and receive an encrypted test message in the new room.

Do not paste old direct invite links into public issue trackers, chats, logs, or docs. Direct invite fragments can carry room key material.

## 4. Verify Room Continuity

Run this checklist with at least two members on separate devices:

- Each device shows the new relay HTTP and WebSocket URLs in Settings.
- Each member is signed in to GitHub through the new relay, if relay auth is required.
- Each migrated room can send and receive a new encrypted chat message.
- A small attachment uploads, downloads, and decrypts from the new relay.
- The active host can claim or remain host on the new relay.
- A Codex approval flow still uses the host's local Codex rather than relay credentials.
- Existing local history remains readable on the devices that retained it.
- A relay restart preserves signed-in sessions only when `MULTAIPLAYER_RELAY_SESSION_SECRET` is stable.
- A removed test member loses future relay access and needs a fresh invite to return.

If a device cannot read its previous local history, stop and preserve that device state before clearing rooms or reinstalling. Local history and room keys are device-local; the relay cannot reconstruct them.

## 5. Cut Over Team Usage

Once the verification checklist passes:

1. Tell the team that the self-hosted relay is now the active relay.
2. Keep the hosted relay rooms quiet/read-only by convention.
3. Post a final hosted-relay room message that points to the self-hosted relay URLs and notes the cutover time.
4. Keep the hosted relay available through the planned observation period or through the hosted sunset window.
5. Rotate room keys where appropriate after everyone has joined the replacement room. In the alpha, room-key rotation is hygiene for future messages, not full cryptographic member removal.

## Rollback

If the self-hosted relay fails before the team has fully cut over, members can switch Settings back to the hosted relay URLs and continue in the original rooms, subject to hosted relay availability. Messages sent only on the self-hosted relay during the failed migration are not copied back automatically.

If the hosted relay is in a sunset window, rollback is temporary. Use the remaining notice period to repair self-hosting, collect local history, and complete the migration.

## Hosted Relay Sunset Policy

For the official hosted relay, maintainers commit to at least 90 days' public notice before a planned shutdown. During that notice period:

- sign-in and relay connectivity remain available for migration unless an emergency security or provider incident makes that impossible;
- planned relay drains use `/readyz` not-ready, reject new work, close existing room WebSockets with `1012`, and flush the relay store before exit;
- users can switch Settings to a self-hosted relay and re-establish teams/rooms there;
- migration docs remain published in the repository;
- encrypted export/import, once implemented, remains available as an additional backup and exit path.

Emergency shutdowns may be shorter only for active abuse, legal requirement, provider outage, or credible risk of private-data exposure. In that case, maintainers should publish the reason, preserve as much migration capability as is safe, and prioritize restoring enough relay functionality for users to leave.
