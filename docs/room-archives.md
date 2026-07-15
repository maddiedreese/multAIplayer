# Encrypted room archives

Encrypted room archives provide a portable, passphrase-protected exit path for the display history available on one device. They are intentionally separate from live rooms and MLS recovery.

## Format and limits

- File extension: `.multai.age` (binary age format).
- Encryption: exact-pinned Rust `age` 0.11.1 user-passphrase mode. The passphrase is 12–1024 bytes and is never persisted.
- Payload: version 1 JSON containing an export timestamp, bounded room/team display names, an explicit omission manifest, normalized history, and a SHA-256 digest of that body inside the authenticated ciphertext.
- Maximum encrypted file: 16 MiB. Maximum decrypted JSON: 12 MiB. JSON is additionally bounded to 16 levels, 100,000 nodes, 20,000 entries per array, 128 fields per object, and 2 MiB per string.
- Library: at most 100 imports per device. The encrypted file is stored owner-only in the native app-data archive directory. The plaintext sidecar has only a random id, import time, encrypted byte length, and version.

Native reads reject symlinks, special files, oversize inputs, invalid age headers, wrong passphrases, failed authentication, unknown archive/history versions, malformed timestamps, invalid display metadata, excessive JSON structure, and digest mismatches. Native writes use a new owner-only temporary file, sync it, and atomically rename it; an existing symlink or special-file destination is rejected. The per-device library serializes import/list/open/delete operations, rolls back ciphertext if its metadata write fails, and reconciles crash-left partial ciphertext/sidecar pairs before listing or enforcing the 100-import cap. Recognized symlinks and special files fail recovery closed and are never followed or deleted.

## What is included

The export takes a point-in-time projection of history already available in the desktop store: normalized chat and edit/delete audit records, resolved terminal/browser/file requests, bounded Codex and Git/GitHub activity, local-preview activity, and completed terminal transcripts. Inline attachments and resolved file changes can contain sensitive material. The passphrase protects confidentiality only while it remains secret.

On import, the native layer validates the encrypted envelope and structural bounds. The webview then sends every supported history collection through the existing local-history/protocol normalizers and constructs a read-only projection. Invalid records are dropped. The projection has no store hydration or action callbacks.

## What is never included

Archives exclude MLS group snapshots and private trees, epochs, group/exporter/history secrets, signing and HPKE private keys, device credentials, KeyPackages, Welcome messages, invite capabilities and admissions, host-handoff packages/authority, pending approvals, queued Codex turns, active goals, Codex thread/session ids, browser profiles, running terminals/process handles, project-directory authority, relay sessions, and attachment-blob ciphertext.

Consequently, an archive cannot:

- join, recreate, migrate, host, or send to a room;
- recover an expired relay attachment blob;
- approve or execute terminal, file, browser, Git, or Codex work;
- recover device identity or MLS forward-secrecy state; or
- merge history into a live room.

Keep normal Git/project backups and test an archive with its passphrase before relying on it. If the passphrase is lost, neither multAIplayer nor the relay can recover the archive.
