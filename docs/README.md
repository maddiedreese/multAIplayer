# Documentation map

You do not need to read every document before using or contributing to
multAIplayer. Choose the path that matches the work in front of you.

## Use the app

1. [Using the app](using-the-app.md) — normal workflows and UI behavior.
2. [Alpha limitations](alpha-limitations.md) — current release and product limits.
3. [FAQ](faq.md) — short answers with links to the maintained source.

## Make a first contribution

1. [Contributing](../CONTRIBUTING.md) — setup, the fast development loop, and the
   checks required for a pull request.
2. [Product and architecture](product-architecture.md) — where code belongs and
   the main data flows.
3. Read a deeper guide only for the boundary you are changing:
   [message lifecycles](message-lifecycles.md), [Codex hosting](codex-hosting.md),
   [protocol](protocol.md), or [cryptography](cryptography.md).

Architecture decisions are constraints, not onboarding material. Consult the
[ADR index](decisions/README.md) when a change crosses an existing design or trust
boundary; add or supersede a decision when the boundary itself changes.

## Operate or review the system

- [Self-hosting](self-hosting.md) is the operator runbook.
- [Threat model](threat-model.md) is the authoritative security-claims and
  residual-risk document.
- [External review packet](external-review-packet.md) defines the narrow review
  scope and maps it to evidence.
- [Tauri IPC boundary audit](tauri-ipc-boundary-audit.md) is the manually reviewed
  native-command inventory, with automated registration-drift detection.
- [Reproducing release builds](reproducible-builds.md) covers artifact and updater
  verification.
- [Security policy](../SECURITY.md) explains private vulnerability reporting.

## Source-of-truth rules

To keep the documentation graph manageable:

- security claims and residual risks belong in the threat model;
- durable architecture constraints belong in ADRs;
- deployment commands and operator checks belong in self-hosting;
- contributor setup and merge expectations belong in CONTRIBUTING;
- user-facing behavior belongs in Using the app;
- other pages should link to those sources instead of copying their policy.

Historical detail may remain in an ADR or changelog, but it should not become a
second current policy. When facts disagree, fix the authoritative document first
and replace duplicates with a link.
