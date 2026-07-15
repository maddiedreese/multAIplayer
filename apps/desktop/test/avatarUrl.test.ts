import assert from "node:assert/strict";
import test from "node:test";
import { trustedAvatarUrl } from "../src/lib/core/avatarUrl";

test("trustedAvatarUrl allows GitHub avatar hosts", () => {
  assert.equal(
    trustedAvatarUrl("https://avatars.githubusercontent.com/u/123?v=4"),
    "https://avatars.githubusercontent.com/u/123?v=4"
  );
  assert.equal(
    trustedAvatarUrl("https://user-images.githubusercontent.com/example.png"),
    "https://user-images.githubusercontent.com/example.png"
  );
});

test("trustedAvatarUrl rejects non-GitHub and non-HTTPS avatar URLs", () => {
  assert.equal(trustedAvatarUrl("https://evil.example/beacon.png"), undefined);
  assert.equal(trustedAvatarUrl("http://avatars.githubusercontent.com/u/123"), undefined);
  assert.equal(trustedAvatarUrl("not a url"), undefined);
  assert.equal(trustedAvatarUrl(undefined), undefined);
});
