## What changed

Describe the user-visible or engineering outcome and why this approach is maintainable.

## Verification

List the focused checks you ran and any scheduled/advisory evidence reviewers should revisit.
Name commands and check suites rather than a hand-counted total that will become stale.

## Security claims

- [ ] Does this change a security claim? Link the doc update.

## Review hygiene

- [ ] The PR title is a customer-readable Conventional Commit title; it will become the squash commit and release-history entry.
- [ ] The title names the concrete defect or outcome rather than generic `cleanup`, `polish`, or `final audit` work.
- [ ] I kept the change cohesive and removed superseded code, tests, policy, and documentation.
- [ ] Required checks and any added release gate are proportionate to the risk and reliable enough to block a merge.
- [ ] Any agent/model passes are described as additional automated review passes, not independent review.
