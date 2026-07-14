import assert from "node:assert/strict";
import test from "node:test";
import {
  compareNativeCommandErrorCodes,
  findNativeCommandErrorCodeMismatches,
  findTauriCommandErrorViolations,
  inspectTauriCommandErrors
} from "./check-tauri-command-errors.mjs";

test("rejects string and other direct Result errors at a Tauri command boundary", () => {
  const source = `
    #[tauri::command]
    pub(crate) fn legacy() -> Result<Vec<String>, String> { todo!() }

    #[tauri::command(rename_all = "camelCase")]
    async fn other() -> std::result::Result<(), DomainError> { todo!() }
  `;

  assert.deepEqual(inspectTauriCommandErrors(source, "fixture.rs"), [
    "fixture.rs: legacy returns Result directly; use crate::command_error::CommandResult",
    "fixture.rs: other returns Result directly; use crate::command_error::CommandResult"
  ]);
});

test("allows typed and infallible commands without policing internal helpers", () => {
  const source = `
    fn internal_helper() -> Result<(), String> { Ok(()) }

    #[tauri::command]
    pub fn typed() -> crate::command_error::CommandResult<()> { Ok(()) }

    #[tauri::command]
    fn infallible() -> String { String::new() }
  `;

  assert.deepEqual(inspectTauriCommandErrors(source), []);
});

test("the production Tauri command inventory satisfies the typed boundary", async () => {
  assert.deepEqual(await findTauriCommandErrorViolations(), []);
});

test("compares serde snake-case Rust variants with the TypeScript union", () => {
  const rust = `enum CommandErrorCode { InternalError, ProcessError, }`;
  const typeScript = `type NativeCommandErrorCode = "internal_error" | "storage_error";`;
  assert.deepEqual(compareNativeCommandErrorCodes(rust, typeScript), [
    "Rust-only native command error codes: process_error",
    "TypeScript-only native command error codes: storage_error"
  ]);
});

test("the production Rust and TypeScript code vocabularies match", async () => {
  assert.deepEqual(await findNativeCommandErrorCodeMismatches(), []);
});
