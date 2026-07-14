import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeNative,
  NativeCommandError,
  normalizeNativeCommandError
} from "../src/lib/nativeCommandError";

test("structured Tauri rejections become Error instances with stable codes", async () => {
  const binding = async () => {
    throw { code: "requires_rejoin", message: "Copy can change" };
  };

  await assert.rejects(
    invokeNative("mls_group_open", undefined, binding),
    (error) =>
      error instanceof NativeCommandError &&
      error.code === "requires_rejoin" &&
      error.message === "Copy can change" &&
      String(error) === "NativeCommandError: Copy can change"
  );
});

test("legacy strings remain readable during boundary migration", () => {
  const error = normalizeNativeCommandError("Existing native failure copy");
  assert.equal(error.code, "internal_error");
  assert.equal(error.message, "Existing native failure copy");
});

test("malformed rejection objects do not render as object prose", () => {
  const error = normalizeNativeCommandError({ code: "unknown", secret: "hidden" });
  assert.equal(error.code, "internal_error");
  assert.equal(error.message, "The native command could not be completed.");
  assert.doesNotMatch(String(error), /object Object|hidden/);
});
