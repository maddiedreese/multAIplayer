# If this project goes unmaintained

multAIplayer is currently maintained by one person. If releases, security fixes, or the hosted relay stop, the repository remains available under the Apache-2.0 license, but nobody is promising continued hosted infrastructure or compatibility with future operating systems and upstream services.

## Preserve and export your data

Do this while every relevant device and the hosted relay are still available:

1. Keep each device installed and its rooms visible. Native MLS state, retained history secrets, and encrypted local history are device-local; the relay cannot recreate them.
2. Export important rooms from **Room settings → Encrypted room archives** with a strong passphrase. Test-import each archive while the device still works, and keep the passphrase separately. Use Markdown only when you intentionally need a plaintext copy.
3. Back up project directories and push Git branches/remotes. multAIplayer is not a source-code backup service.
4. Save attachments that matter outside relay storage. A relay migration does not copy encrypted attachment blobs automatically.
5. Preserve any host-local Codex work through normal commits, patches, and project backups.

Encrypted room archives are a data-exit path, not a room backup or membership migration. They preserve normalized display history in a bounded, versioned `age` passphrase file and import into a device-local read-only library. They deliberately omit MLS group/epoch/exporter/private state, device keys, invite capabilities, KeyPackages, Welcome messages, pending approvals, queued turns, host-handoff authority, Codex thread/session ids, browser profiles, live processes, and encrypted attachment-blob bodies. An imported archive cannot send, execute, join, host, or restore a live room. See [Encrypted room archives](room-archives.md) for the exact boundary.

## Self-host forever

Fork or archive a known-good repository revision, including its lockfile and release artifacts. Follow [Self-hosting](self-hosting.md) to build the relay and desktop, configure durable storage, HTTPS/WSS, exact origins, auth, a stable session secret, quotas, and backups. A custom relay origin requires a self-built desktop whose Tauri CSP permits that HTTPS/WSS origin.

Use the [hosted-to-self-hosted migration procedure](engineering-practices.md#hosted-to-self-hosted-migration) while the old relay is reachable. Migration recreates teams, rooms, membership, sessions, and invites; it does not transfer live-room history, MLS private state, group secrets, or exporter-derived history secrets. Encrypted room archives can carry inert display history separately, but cannot restore membership or cryptographic continuity. Keep the original devices intact until the replacement rooms and archives have been verified.

Pin and mirror all dependencies needed for rebuilding. Maintain your own GitHub OAuth app and Apple signing/notarization setup if distributing macOS builds. If upstream GitHub, Codex, Tauri, WebKit, Node, or Rust behavior changes, a frozen build may eventually require maintenance even when the relay continues to run.

For a private, trusted network, the documented unauthenticated mode remains available only when explicitly configured. Internet-facing deployments should keep authentication, rate limits, persistent storage, backups, and the production relay doctor enabled. Continue monitoring published dependency vulnerabilities; “self-host forever” means you assume the maintainer and operator responsibilities.

## Hosted relay shutdown

The planned-shutdown policy remains at least 30 days' public notice, with migration access kept available when safely possible. Emergencies involving abuse, law, provider failure, or credible exposure risk may force a shorter window. The practical safeguard is therefore local/exported copies plus a tested self-hosted deployment, not the notice period alone.
