# If this project goes unmaintained

multAIplayer is currently maintained by one person, Maddie D. Reese. If releases,
security fixes, or the hosted relay stop, the repository remains available under
the Apache-2.0 license. Continued hosted infrastructure and compatibility with
future operating systems or upstream services are not guaranteed.

## Preserve and export your data

Do this while every relevant device and the hosted relay are still available:

1. Keep each device installed and its rooms visible. Native MLS state, retained history secrets, and encrypted local history are device-local; the relay cannot recreate them.
2. Export important rooms from **Room settings → Encrypted room archives** with a strong passphrase. Test-import each archive while the device still works, and keep the passphrase separately. Use Markdown only when you intentionally need a plaintext copy.
3. Back up project directories and push Git branches/remotes. multAIplayer is not a source-code backup service.
4. Save attachments that matter outside relay storage. A relay migration does not copy encrypted attachment blobs automatically.
5. Preserve any host-local Codex work through normal commits, patches, and project backups.

Encrypted room archives are a data-exit path, not a room backup or membership migration. They preserve normalized display history in a bounded, versioned `age` passphrase file and import into a device-local read-only library. They deliberately omit MLS group/epoch/exporter/private state, device keys, invite capabilities, KeyPackages, Welcome messages, pending approvals, queued turns, host-handoff authority, Codex thread/session ids, live processes, and encrypted attachment-blob bodies. An imported archive cannot send, execute, join, host, or restore a live room. See [Encrypted room archives](room-archives.md) for the exact boundary.

## Continue with a self-hosted deployment

Fork or archive a known-good repository revision, including its lockfile and release artifacts. Follow [Self-hosting](self-hosting.md) to build the relay and desktop, configure durable storage, HTTPS/WSS, exact origins, auth, quotas, and backups. A custom relay origin requires a self-built desktop whose Tauri CSP permits that HTTPS/WSS origin.

Use the [hosted-to-self-hosted migration procedure](self-hosting.md#migrating-from-the-hosted-relay) while the old relay is reachable. Migration recreates teams, rooms, membership, sessions, and invites; it does not transfer live-room history, MLS private state, group secrets, or exporter-derived history secrets. Encrypted room archives can carry inert display history separately, but cannot restore membership or cryptographic continuity. Keep the original devices intact until the replacement rooms and archives have been verified.

Pin and mirror all dependencies needed for rebuilding. Maintain your own GitHub OAuth app and Apple signing/notarization setup if distributing macOS builds. If upstream GitHub, Codex, Tauri, WebKit, Node, or Rust behavior changes, a frozen build may eventually require maintenance even when the relay continues to run.

For a private, trusted network, the documented unauthenticated mode remains available only when explicitly configured. Internet-facing deployments should keep authentication, rate limits, persistent storage, backups, and the production relay doctor enabled. Continue monitoring published dependency vulnerabilities. A frozen deployment may need code and dependency maintenance as its operating system and upstream services change.

## Hosted relay shutdown

Advance notice and migration access will be provided when reasonably possible.
Abuse, legal requirements, provider failure, cost, or a credible exposure risk may
require shutdown without advance notice. Local exports, ordinary project backups,
and a tested self-hosted deployment are the available continuity measures.
