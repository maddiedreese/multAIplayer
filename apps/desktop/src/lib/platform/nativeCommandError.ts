import { invoke } from "@tauri-apps/api/core";
import nativeCommandErrorCodeMap from "../../../native-command-error-codes.json";

export type NativeCommandErrorCode = keyof typeof nativeCommandErrorCodeMap;

const nativeCommandErrorCodes = new Set<NativeCommandErrorCode>(
  Object.keys(nativeCommandErrorCodeMap) as NativeCommandErrorCode[]
);
const maxNativeCommandErrorMessageChars = 801;
const fallbackNativeCommandErrorMessage = "The native command could not be completed.";

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
    return new NativeCommandError(error.code, boundNativeCommandErrorMessage(error.message));
  }
  return new NativeCommandError("internal_error", fallbackNativeCommandErrorMessage);
}

function boundNativeCommandErrorMessage(message: string): string {
  return Array.from(message).slice(0, maxNativeCommandErrorMessageChars).join("") || fallbackNativeCommandErrorMessage;
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
