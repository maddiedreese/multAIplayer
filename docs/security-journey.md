# Deterministic security journey

The `security-journey` CI job exercises the encrypted multi-client lifecycle without a real Codex binary or network relay. It creates host, invited-member, and removed-member device identities; wraps the initial room key for both members; exchanges an encrypted message; rotates to a new epoch after removal; and proves the remaining member can recover the new key while the removed device cannot unwrap it or decrypt subsequent traffic.

The same gate scans every serialized wire artifact for the stable canary strings in `apps/desktop/test/fixtures/injection-red-team-v1.json`. Add a new versioned fixture when the corpus meaning changes; append cases without changing the version when only coverage expands.

The injection half sends adversarial room messages, attachment names, and simulated Codex server approval requests through the production context framing and injectable Codex transport. It verifies that room material retains explicit untrusted framing, a non-host cannot approve a turn, and model-originated approval requests receive no automatic response. CI publishes the JUnit result as the `security-journey-results` artifact.

Run it locally with:

```sh
npm run test:security-journey
```

## Desktop browser journeys

Playwright runs the actual desktop web shell against the real relay. The focused
`desktop-security-journeys.spec.ts` cases independently cover three user-facing authorization boundaries:

- an approval-gated invite selects the room but cannot send until the host explicitly admits the device;
- removing a member advances the local room-key epoch, revokes the removed relay session, and withholds later messages;
- accepting a host handoff transfers both the handoff action and Codex model controls to the successor.

These focused cases make UI regressions attributable to one journey. The longer
`room-lifecycle.spec.ts` remains the cryptographic composition proof: it carries one room through rotation, removal,
handoff, old-key decryption rejection, and relay persistence scanning. Run the complete browser suite with
`npm run test:e2e`, or only the focused desktop cases with
`npm run test:e2e -- e2e/desktop-security-journeys.spec.ts`.

## Host execution limits

Native Codex turns use a validated 10–900 second timeout and bounded input. Codex JSON-RPC requests also have request deadlines. Terminal sessions are intentionally interactive rather than wall-clock limited, but retain at most 1,000 redacted output lines and bound an unterminated redaction buffer to 8 KiB; every initial command and later input requires a short-lived native authorization token. Local preview tunnels have a 20-second startup deadline, retain bounded startup logs, and terminate their child process when stopped or dropped. CI jobs and desktop test subprocesses have independent hard timeouts.
