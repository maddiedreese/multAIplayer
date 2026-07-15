const shards = {
  authz: {
    mutate: ["src/authz.ts"],
    command: "tsx --test test/security-units.test.ts"
  },
  session: {
    mutate: ["src/auth/session.ts"],
    command: "tsx --test test/auth/session-persistence.test.ts"
  },
  "websocket-admission": {
    mutate: ["src/ws/connection-admission.ts"],
    command: "tsx --test test/ws/connection-admission.test.ts"
  },
  "room-create": {
    mutate: ["src/http/room-create-route.ts"],
    command: "tsx --test test/http/rooms.test.ts"
  },
  "room-host": {
    mutate: ["src/http/room-host-route.ts"],
    command: "tsx --test test/http/rooms.test.ts"
  },
  "room-lifecycle": {
    mutate: ["src/http/room-lifecycle-route.ts"],
    command: "tsx --test test/http/rooms.test.ts"
  },
  "room-settings": {
    mutate: ["src/http/room-settings-route.ts", "src/http/room-validation.ts"],
    command: "tsx --test test/http/rooms.test.ts"
  }
};

const selectedShard = process.env.MULTAIPLAYER_MUTATION_SHARD;
if (selectedShard && !Object.hasOwn(shards, selectedShard)) {
  throw new Error(`Unknown MULTAIPLAYER_MUTATION_SHARD: ${selectedShard}`);
}
const selection = selectedShard
  ? shards[selectedShard]
  : {
      mutate: Object.values(shards).flatMap(({ mutate }) => mutate),
      command:
        "tsx --test test/security-units.test.ts test/auth/session-persistence.test.ts test/ws/connection-admission.test.ts test/http/rooms.test.ts"
    };

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // Weekly-only depth coverage for the relay's authorization, admission,
  // session, and room-mutation decisions. This intentionally does not run on
  // pull requests: the focused test command is repeated for every mutant.
  mutate: selection.mutate,
  testRunner: "command",
  commandRunner: { command: selection.command },
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  coverageAnalysis: "off",
  timeoutMS: 15000,
  // Stryker's colors are not policy. report.mjs enforces only measured,
  // checked-in baselines and emits monthly candidates toward the 80% target.
  thresholds: { high: 80, low: 0, break: 0 },
  tempDirName: ".stryker-tmp"
};
