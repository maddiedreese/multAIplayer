import { useEffect, useRef } from "react";

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Preserves callback and wrapper-object identities while keeping callbacks
 * pointed at the latest render's implementation.
 */
export function useStableComposition<T>(value: T): T {
  const latestValue = useRef(value);
  const previousValue = useRef<T | undefined>(undefined);
  const callbackProxies = useRef(new Map<string, AnyFunction>());

  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  const stabilized = stabilizeNode(
    value,
    previousValue.current,
    latestValue,
    callbackProxies.current,
    []
  ) as T;
  previousValue.current = stabilized;
  return stabilized;
}

function stabilizeNode(
  current: unknown,
  previous: unknown,
  latestRoot: { current: unknown },
  callbackProxies: Map<string, AnyFunction>,
  path: string[]
): unknown {
  if (typeof current === "function") {
    const key = path.join("\u0000");
    const existing = callbackProxies.get(key);
    if (existing) return existing;
    const proxy: AnyFunction = (...args) => {
      const callback = valueAtPath(latestRoot.current, path);
      if (typeof callback !== "function") {
        throw new Error(`Stable composition callback is unavailable at ${path.join(".")}`);
      }
      return Reflect.apply(callback, undefined, args);
    };
    callbackProxies.set(key, proxy);
    return proxy;
  }

  if (!isPlainObject(current)) return current;

  const previousObject = isPlainObject(previous) ? previous : undefined;
  const keys = Object.keys(current);
  let unchanged = previousObject !== undefined && Object.keys(previousObject).length === keys.length;
  const next: Record<string, unknown> = {};

  for (const key of keys) {
    const child = stabilizeNode(
      current[key],
      previousObject?.[key],
      latestRoot,
      callbackProxies,
      [...path, key]
    );
    next[key] = child;
    if (child !== previousObject?.[key]) unchanged = false;
  }

  return unchanged ? previousObject : next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valueAtPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}
