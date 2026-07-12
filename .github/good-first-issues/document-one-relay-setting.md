# Document and test one relay configuration setting

## Why this is a good first issue

Relay settings follow a repeated pattern: parse an environment value, validate it, expose it in `.env.example`, and describe it in the self-hosting table. This task teaches that path without changing authentication, encryption, or authorization.

## Scope

Clarify the units, default, and supported range for `MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS` in `.env.example` and `docs/self-hosting.md`, then add or improve one configuration-parser test for its invalid-input fallback.

Do not introduce a new environment variable, change its default, or touch credential/session handling in this issue.

## Acceptance criteria

- [ ] `.env.example` and `docs/self-hosting.md` agree on the setting's default and units.
- [ ] A focused test covers one malformed or out-of-range value.
- [ ] `npm run test -w @multaiplayer/relay` passes.
- [ ] `npm run test:scripts` passes, including documentation-drift checks.
- [ ] No production behavior, wire format, or security policy changes are included.

## Starting points

- `.env.example`
- `apps/relay/src/config.ts`
- `apps/relay/test/config.test.ts`
- `docs/self-hosting.md`
- `scripts/project-hygiene.test.mjs`

Live ticket: [#189 — Document and test MULTAIPLAYER_RELAY_SHUTDOWN_DRAIN_MS validation](https://github.com/maddiedreese/multAIplayer/issues/189).
