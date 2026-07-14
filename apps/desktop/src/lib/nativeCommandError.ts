import { invoke } from "@tauri-apps/api/core";

export type NativeCommandErrorCode =
  | "crypto_error"
  | "internal_error"
  | "invalid_argument"
  | "not_found"
  | "process_error"
  | "requires_rejoin"
  | "storage_error"
  | "unauthorized"
  | "unavailable";

const nativeCommandErrorCodes = new Set<NativeCommandErrorCode>([
  "crypto_error",
  "internal_error",
  "invalid_argument",
  "not_found",
  "process_error",
  "requires_rejoin",
  "storage_error",
  "unauthorized",
  "unavailable"
]);

export class NativeCommandError extends Error {
  override readonly name = "NativeCommandError";

  constructor(
    readonly code: NativeCommandErrorCode,
    message: string
  ) {
    super(message);
  }
}

type InvokeBinding = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>,
  binding: InvokeBinding = invoke
): Promise<T> {
  try {
    return await binding<T>(command, args);
  } catch (error) {
    throw normalizeNativeCommandError(error);
  }
}

export function normalizeNativeCommandError(error: unknown): NativeCommandError {
  if (error instanceof NativeCommandError) return error;
  if (isRecord(error) && isSupportedNativeCommandErrorCode(error.code) && typeof error.message === "string") {
    return new NativeCommandError(error.code, error.message);
  }
  if (typeof error === "string") return new NativeCommandError("internal_error", error);
  if (error instanceof Error && error.message) return new NativeCommandError("internal_error", error.message);
  return new NativeCommandError("internal_error", "The native command could not be completed.");
}

export function isNativeCommandErrorCode(error: unknown, code: NativeCommandErrorCode): error is NativeCommandError {
  return error instanceof NativeCommandError && error.code === code;
}

function isSupportedNativeCommandErrorCode(value: unknown): value is NativeCommandErrorCode {
  return typeof value === "string" && nativeCommandErrorCodes.has(value as NativeCommandErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
