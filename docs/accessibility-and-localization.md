# Accessibility and localization

## Current support

The alpha UI is English-only. User-facing strings live alongside React components; there is no translation catalog or right-to-left layout guarantee. Do not describe the application as localized until those foundations and at least one non-English locale are tested.

Accessibility is a release quality requirement even before formal conformance certification. Required Playwright journeys run exact-pinned axe-core WCAG 2.0, 2.1, and 2.2 A/AA rules against the production-component chat, onboarding, and invite scenarios in addition to exercising semantic roles and accessible names. The desktop runner also includes both `.test.ts` and `.test.tsx` component suites. These automated checks catch regressions but do not establish conformance or replace the release audit below.

The first-run setup uses one heading and native buttons, links, inputs, forms, details, lists, status regions, alerts, and progressbar semantics. Moving between setup surfaces transfers focus to the new heading without trapping focus. Readiness is communicated with text as well as icons and color; blocking states disable forward progress and expose a named recovery action. Async invite, folder, and workspace outcomes use status or alert regions rather than relying on a transient visual change.

Authentication keeps the GitHub user code selectable and copyable, states its expiry in text, and provides named Open, Copy, Cancel, and retry actions. GitHub and ChatGPT/Codex are labeled as different accounts and purposes. A failed system-browser launch becomes an alert with a copy-link fallback instead of an inaccessible silent failure. Native invitation activation announces that an invitation is ready without placing the bearer capability in an accessibility name, notification, or persistent region.

Create and join are peers in the reading and tab order. Back, Save and close, Explore, checklist dismissal, and Help-based reopen/restart controls make the flow skippable and resumable without requiring pointer input. Starter prompts are buttons that populate the composer only, so keyboard and assistive-technology users retain the same explicit send and approval boundaries as pointer users.

The setup surface reflows to a single narrow column. Progress transitions are removed under `prefers-reduced-motion`. Text labels remain visible for icon-only controls through accessible names. Copy should stay sentence-cased and plain-language; readiness and recovery text must not interpolate raw paths, tokens, account responses, or upstream errors.

## Release audit

Before a public release, record an audit issue covering keyboard operation and focus; VoiceOver on the supported macOS version for sign-in, invite acceptance, host handoff, Codex approval, messaging, settings, and recovery; 200% text zoom, narrow-window reflow, reduced motion, and contrast; axe checks plus manual review; labels, status announcements, validation, dialogs, and icon-only controls; and WCAG 2.2 AA color contrast.

Record the commit, OS/browser versions, assistive technology, findings, severity, owner, and remediation status. A finding that prevents a security approval, sign-in, messaging, or recovery flow blocks release.

## Localization-ready changes

Avoid concatenated sentence fragments, text embedded in images, assumed English word order, and color-only meaning. Use platform internationalization APIs for dates, times, numbers, and plurals, and tolerate longer labels. A future localization change should add typed message identifiers, extraction, fallback tests, and pseudo-localization before accepting translations.

Authentication expiry, remaining-time, and retry copy must use localized date/duration and plural rules rather than English string concatenation. Provider names, security terms, invite fragments, and user codes should remain separate interpolation values so translations cannot accidentally change their parsing or copy behavior.
