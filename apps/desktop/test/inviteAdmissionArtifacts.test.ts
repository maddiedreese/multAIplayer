import assert from "node:assert/strict";
import test from "node:test";
import { publishInviteAdmissionArtifacts } from "../src/application/invite/inviteRelayActions";

test("invite admission never publishes Welcome when encrypted config publication fails", async () => {
  const effects: string[] = [];

  await assert.rejects(
    publishInviteAdmissionArtifacts({
      publishConfig: async () => {
        effects.push("config");
        throw new Error("config unavailable");
      },
      publishWelcome: async () => {
        effects.push("welcome");
      },
      markWelcomePublished: async () => {
        effects.push("welcome-persisted");
      }
    }),
    /config unavailable/
  );

  assert.deepEqual(effects, ["config"]);
});

test("invite admission persists config before exposing and completing Welcome", async () => {
  const effects: string[] = [];

  await publishInviteAdmissionArtifacts({
    publishConfig: async () => {
      effects.push("config");
    },
    publishWelcome: async () => {
      effects.push("welcome");
    },
    markWelcomePublished: async () => {
      effects.push("welcome-persisted");
    }
  });

  assert.deepEqual(effects, ["config", "welcome", "welcome-persisted"]);
});
