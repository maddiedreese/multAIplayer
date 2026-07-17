# Relay synchronous-persistence soak — 2026-07-15

This record quantifies the event-loop cost of synchronous `better-sqlite3` writes under a representative alpha workload. It combines a short local checkpoint comparison with a longer Railway-volume follow-up. The results are regression and capacity evidence, not a hosted-service SLO.

This workload did not fill the configurable MLS-backlog or attachment-ciphertext byte ceilings and therefore does not validate their defaults or establish a safe maximum resident dataset. Those limits are conservative guardrails that must be tuned against measured memory on the actual host; the results below support the synchronous-write and WAL-checkpoint decision only.

## Workload and environment

- Local comparison source commit: `1e582296dba3196efd16c22f4763eca576c191b6`.
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

| Measurement                                    | SQLite default checkpoint (1000 pages) | Tuned checkpoint (250 pages) |
| ---------------------------------------------- | -------------------------------------: | ---------------------------: |
| Published messages                             |                                  1,427 |                        1,292 |
| HTTP request samples                           |                                    391 |                          355 |
| HTTP request latency p99                       |                                72.1 ms |                     169.7 ms |
| Publish acknowledgement p99                    |                                  33 ms |                        61 ms |
| Event-loop delay p99                           |                               147.3 ms |                     114.8 ms |
| Event-loop delay max                           |                               325.3 ms |                     170.5 ms |
| Maximum WAL size                               |                        4,140,632 bytes |              1,067,112 bytes |
| Integrity / ordering / leaked sockets / errors |                    pass / pass / 0 / 0 |          pass / pass / 0 / 0 |

The default checkpoint produced a 325 ms worst event-loop stall and a roughly 4 MiB WAL. Testing the preselected first lever at 250 pages reduced the observed worst stall by 48% and bounded this run's WAL near 1 MiB, but HTTP request p99 worsened from 72 ms to 170 ms and acknowledgement p99 from 33 ms to 61 ms. This short, mixed-workload comparison did not justify changing the default.

## Railway-volume follow-up

The hosted follow-up ran on 2026-07-15 PDT for 905.3 seconds against the 5 GB persistent volume mounted by the production Railway relay. It exercised deployed commit `ca52f4f71e658700b662b8e7849db2a5a7b2ea60` with the default 1000-page WAL checkpoint, 50 rooms, 100 members, 16 concurrent reconnecting clients, two relay start/reload phases, continuous publication and `GET /teams`, and a live backup with an independent SQLite integrity check.

To avoid corrupting or measuring against user data, the runner launched a second loopback-only relay on port 4322 and gave it a UUID-named SQLite database under `/data`. It did not address the public listener or open `/data/relay-store.sqlite`. A `finally` cleanup removed the isolated directory; an independent directory scan found no `relay-hosted-soak-*` paths afterward, and the public `/readyz` response returned healthy. Readiness responses no longer expose the configured filesystem path.

| Hosted measurement                                  |                      Result |
| --------------------------------------------------- | --------------------------: |
| Published messages / reconnects                     |             47,309 / 94,456 |
| HTTP request latency p99                            |                     67.2 ms |
| Publish acknowledgement p99                         |                     54.1 ms |
| Event-loop delay p99 / max                          |         104.9 ms / 245.2 ms |
| Final-phase SQLite writes / mean duration           |            23,773 / 0.83 ms |
| Final-phase SQLite writes at or below 1 / 5 / 25 ms |       96.9% / 98.6% / 99.9% |
| Maximum WAL / benchmark database                    | 4,194,192 / 2,969,600 bytes |
| Minimum filesystem bytes available                  |               4,809,957,376 |
| Railway CPU average / sampled max / limit           |      0.932 / 1.123 / 1 vCPU |
| Railway memory average / max / limit                |  255.6 / 281.1 / 1,024.0 MB |
| Backup / source integrity, leaked sockets, errors   |               ok / ok, 0, 0 |

The hosted request p99 was slightly lower than the local default-checkpoint result, while acknowledgement p99 was higher but remained below the local 250-page experiment. Event-loop p99 and maximum were both below the local default result, and WAL remained close to SQLite's expected roughly 4 MiB default bound. The SQLite histogram is the second phase's interval because those in-process metric counters correctly reset when the isolated relay restarted. That evidence does not support changing the checkpoint setting. The deliberately continuous workload did consume nearly all of the one-vCPU allocation on average; Railway reports usage but does not expose CPU-throttled time, so the sampled maximum above one vCPU must not be presented as a throttling measurement. Capacity planning should preserve CPU headroom or move to a larger allocation before expecting this sustained rate.

The complete machine-readable result, exact UTC window, histogram buckets, deployment identity, platform resource summary, isolation paths, and cleanup verification are retained in [`artifacts/relay-railway-volume-soak-2026-07-15.json`](artifacts/relay-railway-volume-soak-2026-07-15.json). Keep fail-closed synchronous persistence and the 1000-page default; WAL checkpoint tuning remains the first lever only if later production-shaped measurements breach an explicit latency or storage target.
