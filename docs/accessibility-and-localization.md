# Accessibility and localization

## Current support

The alpha UI is English-only. User-facing strings live alongside React components; there is no translation catalog or right-to-left layout guarantee. Do not describe the application as localized until those foundations and at least one non-English locale are tested.

Accessibility is a release quality requirement even before formal conformance certification. Playwright journeys exercise semantic roles and accessible names for critical controls, but automated checks do not establish conformance.

## Release audit

Before a public release, record an audit issue covering keyboard operation and focus; VoiceOver on the supported macOS version for sign-in, invite acceptance, host handoff, Codex approval, messaging, settings, and recovery; 200% text zoom, narrow-window reflow, reduced motion, and contrast; axe checks plus manual review; labels, status announcements, validation, dialogs, and icon-only controls; and WCAG 2.2 AA color contrast.

Record the commit, OS/browser versions, assistive technology, findings, severity, owner, and remediation status. A finding that prevents a security approval, sign-in, messaging, or recovery flow blocks release.

## Localization-ready changes

Avoid concatenated sentence fragments, text embedded in images, assumed English word order, and color-only meaning. Use platform internationalization APIs for dates, times, numbers, and plurals, and tolerate longer labels. A future localization change should add typed message identifiers, extraction, fallback tests, and pseudo-localization before accepting translations.
