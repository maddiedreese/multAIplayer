# Add a keyboard-navigation regression test for one desktop dialog

## Why this is a good first issue

The desktop app already has component tests and shared accessibility conventions. This task is deliberately limited to one existing dialog, so it introduces the test setup without requiring protocol, cryptography, relay, or Rust changes.

## Scope

Choose one dialog that does not yet have an explicit keyboard test and add a regression test that proves:

- focus moves into the dialog when it opens;
- Tab and Shift+Tab stay within the dialog;
- Escape follows the dialog's documented close policy; and
- the primary action has an accessible name.

Prefer `CodexServerRequestDialog` if no one is already changing it. Reuse the existing test helpers and semantic queries; do not add production-only selectors.

## Acceptance criteria

- [ ] One focused regression test covers the four behaviors above.
- [ ] Any behavior change is documented in the component copy or `docs/accessibility-and-localization.md`.
- [ ] `npm run test -w @multaiplayer/desktop` passes.
- [ ] `npm run lint` and `npm run format:check` pass.
- [ ] No crypto, protocol, or relay wire format changes are included.

## Starting points

- `apps/desktop/src/components/CodexServerRequestDialog.tsx`
- nearby `*.test.tsx` files under `apps/desktop/src`
- `docs/accessibility-and-localization.md`
- `scripts/eslint-boundaries.test.mjs` for the module-boundary rules

Live ticket: [#188 — Add keyboard-navigation coverage for CodexServerRequestDialog](https://github.com/maddiedreese/multAIplayer/issues/188).
