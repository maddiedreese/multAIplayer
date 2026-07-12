# Agent-assisted maintainer workflow

MultAIplayer is maintained through an agent-assisted, policy-driven workflow. The maintainer does not treat generated code as trusted merely because it compiles or because an agent reports success. Product intent is translated into explicit repository policy, independent gates, and reviewable evidence.

## From prompt to policy

1. **Specify the outcome and threat boundary.** A work request names the user-visible behavior, protected assets, attacker capabilities, and non-negotiable invariants. Security claims are phrased as properties that can fail, not aspirations.
2. **Inspect before changing.** The agent reads repository guidance, the current implementation, prior ADRs, tests, CI, dependency state, and the working tree. Existing maintainer work is preserved.
3. **Decompose by independent evidence.** Parallel work is used only for bounded streams. One integration owner reconciles shared files and is responsible for the final result.
4. **Implement the smallest coherent boundary.** Production changes include tests, failure behavior, limits, and documentation in the same pull request. Secrets, shell authority, cryptographic state, and publishing credentials stay outside model-controlled/webview boundaries.
5. **Turn claims into gates.** Important invariants become deterministic unit/property tests, mutation policies, cross-implementation vectors, scripted journeys, static analysis, or artifact verification. Generated reports are retained when reviewers need more than pass/fail.
6. **Review the diff as hostile input.** The maintainer checks authorization placement, fallback behavior, parser ambiguity, unbounded resources, workflow permissions, dependency scripts, binary additions, and documentation drift.
7. **Verify in layers.** Fast focused checks run first, followed by repository-wide format, lint, type, test, build, Rust, security, and packaging checks. A failure is fixed or explicitly documented; gates are not weakened to obtain green status.
8. **Publish through a pull request.** Only scoped files are staged. The PR states why, impact, root cause where relevant, and exact validation. Required checks and review conversations must resolve before merge.
9. **Record durable decisions.** Architecture or security choices become ADRs. Operational limits, advisories, supported platforms, and incident expectations go in maintained documents with review dates.

## Maintainer review questions

- Can untrusted room, attachment, webpage, repository, tool, or model output reach native authority without a fresh native decision?
- Is identity, room, workspace, epoch, exact bytes, expiry, and one-time use bound at the enforcement point?
- Does normalization preserve security markers and reject ambiguous encodings?
- Are network, process, PTY, preview, and model-output paths bounded by time and size?
- Is encrypted state authenticated with canonical context, and is interoperability checked outside the implementation language?
- Does CI use locked inputs, commit-pinned actions, least privilege, and trusted artifact handoffs?
- Would a skeptical reviewer be able to reproduce the evidence from a clean checkout?

## Evidence hierarchy

Passing examples are the baseline. Property tests explore input classes; mutation tests show whether assertions distinguish security-relevant code changes; deterministic journeys prove lifecycle behavior across components; independent implementations prove wire agreement; external analyzers and supply-chain attestations add signals not authored by the same agent that wrote the feature. None of these substitutes for professional security review.

## Exceptions and follow-up

An exception must name its dependency or code path, affected platform, exposure, compensating control, rationale, owner, and review date. It must not be hidden by suppressing a scanner solely to improve a score. Deferred work is tracked in docs or issues with a concrete trigger for reconsideration.
