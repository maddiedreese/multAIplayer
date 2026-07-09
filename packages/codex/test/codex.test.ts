import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitializeRequest } from "../src/index";

test("initialize request identifies multAIplayer to codex app-server", () => {
  assert.deepEqual(createInitializeRequest(7), {
    method: "initialize",
    id: 7,
    params: {
      clientInfo: {
        name: "multaiplayer",
        title: "multAIplayer",
        version: "0.1.0-alpha.0"
      },
      capabilities: {
        experimentalApi: true
      }
    }
  });
});
