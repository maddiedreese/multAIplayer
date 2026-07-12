# Project governance

multAIplayer currently uses a lightweight, single-maintainer model. This document makes responsibilities and decisions explicit without implying a committee that does not exist.

## Roles

- **Maintainer:** owns releases, repository administration, security response, branch protection, roadmap decisions, and final merge authority. Current maintainers are identified by repository hosting permissions and the public commit/release history.
- **Contributor:** anyone who reports an issue, proposes a design, reviews a change, or submits code or documentation under the contribution attestation in `CONTRIBUTING.md`.
- **Security reporter:** anyone using the private process in `SECURITY.md`. Reporters are kept informed according to that policy and credited when requested and safe.

No contributor receives production credentials or release authority merely by contributing. Additional maintainers may be appointed after sustained, technically sound, security-conscious participation. Appointment and removal are recorded in repository history and hosting permissions.

## Decisions

Routine changes are decided in pull requests. Security-boundary or architectural changes must explain preserved invariants and add or supersede a record in `docs/decisions`. The maintainer seeks consensus but retains final responsibility while the project has one maintainer. Material reversals should be documented rather than hidden in implementation-only changes.

## Releases, conduct, and changes

The maintainer verifies release gates and follows `docs/release-operations.md`. Vulnerabilities follow `SECURITY.md`. Participation follows `CODE_OF_CONDUCT.md`; reports involving the maintainer may use GitHub's private abuse-reporting channel. Governance changes use the normal pull-request process and require an explicit maintainer decision; repository history is the audit trail.
