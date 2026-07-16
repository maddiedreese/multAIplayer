# Architecture decisions

These records explain durable implementation constraints that are easy to miss when reading one feature at a time. Each record states the accepted decision, its consequences, and the conditions that would justify revisiting it.

- [Zustand store boundaries](zustand-store-boundaries.md)
- [Active-host authorization](active-host-authorization.md)
- [Host handoff and key authority](host-handoff.md)
- [Bounded structured Codex collaboration activity](metadata-only-codex-activity.md)
- [MLS protocol v2](mls-protocol-v2.md)
- [Deliberately single-node relay](single-node-relay.md)
- [Typed native command errors](typed-native-command-errors.md)

Add a record when a change introduces a cross-cutting boundary, trust decision,
or constraint that future contributors might otherwise “simplify” away. Prefer
enduring rationale over implementation chronology. Superseded decisions and
implementation chronology remain available in Git history.
