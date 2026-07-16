# Relay synchronous-persistence soak — 2026-07-15

This local measurement quantifies the event-loop cost of synchronous `better-sqlite3` writes under a representative alpha workload. It is a regression datum, not a hosted-service SLO or a capacity claim.

## Workload and environment

- Source baseline: `c33ed8a477287b4633a71e210fc952f92fb76280` plus the operational-readiness changes under review.
- Apple M3, 16 GiB RAM, Darwin arm64; Node `v24.6.0`; npm `11.16.0`.
- 50 hydrated rooms and 100 team members; 16 concurrent reconnecting WebSocket clients; one continuous MLS publisher; continuous `GET /teams` requests; two stop/crash-and-reload cycles; live SQLite backup and restore verification.
- Ten seconds configured workload time per run. Seed `0`, backlog limit `1000`, rate limiting disabled for the benchmark, SQLite WAL enabled.
- Command:

  ```bash
  MULTAIPLAYER_RELAY_SOAK_DURATION_MS=10000 \
  MULTAIPLAYER_RELAY_SOAK_CLIENTS=16 \
  MULTAIPLAYER_RELAY_SOAK_ROOMS=50 \
  MULTAIPLAYER_RELAY_SOAK_MEMBERS=100 \
  MULTAIPLAYER_RELAY_SOAK_RESTART_CYCLES=2 \
  npm run test:soak -w @multaiplayer/relay
  ```

## Results

| Measurement | SQLite default checkpoint (1000 pages) | Tuned checkpoint (250 pages) |
| --- | ---: | ---: |
| Published messages | 1,427 | 1,292 |
| HTTP request samples | 391 | 355 |
| HTTP request latency p99 | 72.1 ms | 169.7 ms |
| Publish acknowledgement p99 | 33 ms | 61 ms |
| Event-loop delay p99 | 147.3 ms | 114.8 ms |
| Event-loop delay max | 325.3 ms | 170.5 ms |
| Maximum WAL size | 4,140,632 bytes | 1,067,112 bytes |
| Integrity / ordering / leaked sockets / errors | pass / pass / 0 / 0 | pass / pass / 0 / 0 |

The default checkpoint produced a 325 ms worst event-loop stall and a roughly 4 MiB WAL. Testing the preselected first lever at 250 pages reduced the observed worst stall by 48% and bounded this run's WAL near 1 MiB, but HTTP request p99 worsened from 72 ms to 170 ms and acknowledgement p99 from 33 ms to 61 ms. This short, mixed-workload comparison does not justify changing the default: the relay keeps SQLite's 1000 pages and exposes `MULTAIPLAYER_RELAY_SQLITE_WAL_AUTOCHECKPOINT_PAGES` for a decision based on longer hosted evidence. Fail-closed synchronous persistence remains unchanged.

Before public exposure, repeat this workload on the Railway volume for at least 15 minutes, retain the JSON artifact, and compare request p99, event-loop p99/max, SQLite-write histograms, CPU throttling, and WAL size. Tune checkpoint pages from hosted measurements; do not replace synchronous durability with write-behind to improve these numbers.
