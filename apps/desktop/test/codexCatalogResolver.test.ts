import assert from "node:assert/strict";
import test from "node:test";
import type { RoomRecord } from "@multaiplayer/protocol";
import {
  catalogModelOptions,
  catalogReasoningOptionsForModel,
  catalogSpeedOptionsForModel,
  resolveCodexRunSettings
} from "../src/lib/codexCatalogResolver";
import type { CodexProbe } from "../src/lib/localBackend";

const room: RoomRecord = {
  id: "room-catalog",
  teamId: "team-core",
  name: "Catalog",
  projectPath: "/tmp/catalog",
  host: "Host",
  hostStatus: "active",
  approvalPolicy: "ask_every_turn",
  approvalDelegationPolicy: "host_only",
  trustedApproverUserIds: [],
  mode: { chat: true, code: true, workspace: true, browser: false },
  codexModel: "legacy-model",
  codexReasoningEffort: "high",
  codexSpeed: "fast",
  browserAllowedOrigins: [],
  browserProfilePersistent: true,
  unread: 0
};

const probe: CodexProbe = {
  available: true,
  version: "0.144.0",
  error: null,
  modelError: null,
  models: [
    {
      id: "catalog-default",
      model: "gpt-next",
      label: "GPT Next",
      description: "Local default",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["none", "low"],
      serviceTiers: ["default"],
      defaultServiceTier: "default"
    }
  ]
};

test("auto policies resolve all run inputs from the host-local model catalog", () => {
  const resolved = resolveCodexRunSettings(
    {
      ...room,
      codexModelPolicy: "auto",
      codexReasoningEffortPolicy: "auto",
      codexServiceTierPolicy: "auto"
    },
    probe
  );

  assert.equal(resolved.model, "gpt-next");
  assert.equal(resolved.reasoningEffort, "low");
  assert.equal(resolved.serviceTier, "default");
  assert.equal(resolved.speed, "standard");
  assert.deepEqual(resolved.warnings, []);
});

test("legacy rooms remain pinned and unsupported pinned choices fall back safely", () => {
  const resolved = resolveCodexRunSettings(room, probe);
  assert.equal(resolved.model, "legacy-model");
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.speed, "fast");
  assert.equal(resolved.modelPolicy, "pinned");
});

test("model-specific UI choices include none and omit unsupported speed tiers", () => {
  assert.deepEqual(
    catalogReasoningOptionsForModel(probe, "gpt-next").map((option) => option.id),
    ["none", "low"]
  );
  assert.deepEqual(
    catalogSpeedOptionsForModel(probe, "gpt-next").map((option) => option.id),
    ["standard"]
  );
});

test("host catalogs augment the current shared model list instead of hiding new models", () => {
  assert.deepEqual(
    catalogModelOptions(probe).map((option) => option.id),
    [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.5-cyber",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-next"
    ]
  );
});

test("pinned unsupported choices resolve to catalog defaults for a known model", () => {
  const resolved = resolveCodexRunSettings(
    {
      ...room,
      codexModel: "gpt-next",
      codexModelPolicy: "pinned",
      codexReasoningEffortPolicy: "pinned",
      codexServiceTierPolicy: "pinned"
    },
    probe
  );
  assert.equal(resolved.reasoningEffort, "low");
  assert.equal(resolved.speed, "standard");
  assert.equal(resolved.warnings.length, 2);
});
