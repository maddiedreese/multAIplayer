# If this project goes unmaintained

multAIplayer is currently maintained by one person. If releases, security fixes, or the hosted relay stop, the repository remains available under the Apache-2.0 license, but nobody is promising continued hosted infrastructure or compatibility with future operating systems and upstream services.

## Preserve and export your data

Do this while every relevant device and the hosted relay are still available:

1. Keep each device installed and its rooms visible. Native MLS state, retained history secrets, and encrypted local history are device-local; the relay cannot recreate them.
2. Export important room transcripts to Markdown from the desktop app. Treat exports as plaintext and store them with access controls appropriate to the conversation.
3. Back up project directories and push Git branches/remotes. multAIplayer is not a source-code backup service.
4. Save attachments that matter outside relay storage. A relay migration does not copy encrypted attachment blobs automatically.
5. Preserve any host-local Codex work through normal commits, patches, and project backups.

Encrypted whole-room export/import is planned but does not exist in the alpha. Until it ships, retained devices, Markdown exports, and ordinary project/Git backups are the usable data exit path.

## Self-host forever

Fork or archive a known-good repository revision, including its lockfile and release artifacts. Follow [Self-hosting](self-hosting.md) to build the relay and desktop, configure durable storage, HTTPS/WSS, exact origins, auth, a stable session secret, quotas, and backups. A custom relay origin requires a self-built desktop whose Tauri CSP permits that HTTPS/WSS origin.

Use the [hosted-to-self-hosted migration procedure](release-operations.md#hosted-to-self-hosted-migration) while the old relay is reachable. Migration recreates teams, rooms, membership, sessions, and invites; it does not transfer plaintext history, MLS private state, group secrets, or exporter-derived history secrets. Keep the original devices intact until the replacement rooms and retained history have been verified.

Pin and mirror all dependencies needed for rebuilding. Maintain your own GitHub OAuth app and Apple signing/notarization setup if distributing macOS builds. If upstream GitHub, Codex, Tauri, WebKit, Node, or Rust behavior changes, a frozen build may eventually require maintenance even when the relay continues to run.

For a private, trusted network, the documented unauthenticated mode remains available only when explicitly configured. Internet-facing deployments should keep authentication, rate limits, persistent storage, backups, and the production relay doctor enabled. Continue monitoring published dependency vulnerabilities; “self-host forever” means you assume the maintainer and operator responsibilities.

## Hosted relay shutdown

The planned-shutdown policy remains at least 30 days' public notice, with migration access kept available when safely possible. Emergencies involving abuse, law, provider failure, or credible exposure risk may force a shorter window. The practical safeguard is therefore local/exported copies plus a tested self-hosted deployment, not the notice period alone.
