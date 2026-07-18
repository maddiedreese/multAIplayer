# multAIplayer CLI task catalog

Every implementation task has a dedicated specification under `tasks/`. Tasks
start paused. Opening or reading a task is not approval to implement it.

| Task | Deliverable | Primary gate |
| --- | --- | --- |
| [CLI-000](tasks/CLI-000.md) | Governance, plan, decisions, and task system | Documentation validation and owner review |
| [CLI-010](tasks/CLI-010.md) | Release isolation and path-aware CI | Existing desktop release contract unchanged |
| [CLI-020](tasks/CLI-020.md) | Inert `multAIplayer` Rust binary | CLI-only check; no desktop lock/package change |
| [CLI-030](tasks/CLI-030.md) | Strict Rust protocol and shared fixtures | TypeScript/Rust compatibility fixtures |
| [CLI-040](tasks/CLI-040.md) | GitHub login, restoration, and device identity | Origin binding and secret-redaction tests |
| [CLI-050](tasks/CLI-050.md) | Relay HTTP/WebSocket client | Ordered ack/reconnect integration tests |
| [CLI-060](tasks/CLI-060.md) | Reusable MLS client state and outbox | Crash-point and stale-epoch tests |
| [CLI-070](tasks/CLI-070.md) | Create/list/open rooms and host project association | Headless room journey |
| [CLI-080](tasks/CLI-080.md) | High-entropy invite codes and admission | Two-device approval/deny/expiry journey |
| [CLI-090](tasks/CLI-090.md) | Encrypted chat, presence, safe terminal rendering | Three-client chat journey |
| [CLI-100](tasks/CLI-100.md) | Replay, history, and restart recovery | Relay/process restart journeys |
| [CLI-110](tasks/CLI-110.md) | UI-independent Codex host runtime | Existing desktop native tests unchanged |
| [CLI-120](tasks/CLI-120.md) | Proposals, context, and hosted turns | Real/fixture Codex turn journey |
| [CLI-130](tasks/CLI-130.md) | Host-only privileged approvals and activity | Cross-room/session denial tests |
| [CLI-140](tasks/CLI-140.md) | Desktop/CLI interoperability | Required mixed-client matrix |
| [CLI-150](tasks/CLI-150.md) | Security hardening and threat-model alignment | Redaction, fuzz, and adversarial journeys |
| [CLI-160](tasks/CLI-160.md) | Signed independent CLI artifacts | Packaging/release isolation verification |
| [CLI-170](tasks/CLI-170.md) | External-alpha release decision | Full acceptance checklist and owner signoff |

