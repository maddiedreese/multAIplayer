# Architecture decisions

The [retrospective hardening ledger](retro-hardening-decisions.md) records ADR-007 through ADR-026, recovering twenty security, architecture, verification, dependency, and release decisions from the project history.

These records explain durable implementation constraints that are easy to miss when reading one feature at a time. Each record states the accepted decision, its consequences, and the conditions that would justify revisiting it.

- [Zustand store boundaries](zustand-store-boundaries.md)
- [Active-host authorization](active-host-authorization.md)
- [Host handoff and key authority](host-handoff.md)
- [Metadata-only Codex activity](metadata-only-codex-activity.md)
- [Multi-repository room evaluation](multi-repository-rooms.md)
- [Epoch crypto and the MLS migration boundary](epoch-crypto-migration-boundary.md)
- [MLS protocol v2](mls-protocol-v2.md)

Add a record when a change introduces a cross-cutting boundary, trust decision, or constraint that future contributors might otherwise “simplify” away. Prefer enduring rationale over implementation chronology.
