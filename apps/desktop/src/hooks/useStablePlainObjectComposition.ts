import { useInsertionEffect, useLayoutEffect, useMemo, useRef } from "react";

type AnyFunction = (...args: unknown[]) => unknown;
type MutableValueRef = { current: unknown };

/**
 * Stabilizes an acyclic plain-object composition tree.
 *
 * Arrays and non-plain objects are opaque, so callbacks inside them are not
 * proxied. Proxied callbacks must run from event handlers or effects, never
 * during render. Their latest implementations are published during commit,
 * before child layout effects can invoke them.
 */
export function useStablePlainObjectComposition<T extends object>(value: T): T {
  if (!isPlainObject(value)) {
    throw new Error("Stable plain-object composition requires a plain-object root");
  }

  const latestValue = useRef(value);
  const previousValue = useRef<T | undefined>(undefined);
  const callbackShape = callbackPathSignature(value);
  const callbackProxies = useMemo(
    () => createCallbackProxies(callbackShape, latestValue),
    [callbackShape]
  );
  const stabilized = stabilizeNode(
    value,
    previousValue.current,
    latestValue,
    callbackProxies,
    []
  ) as T;

  useInsertionEffect(() => {
    latestValue.current = value;
  }, [value]);

  useLayoutEffect(() => {
    previousValue.current = stabilized;
  }, [stabilized]);

  return stabilized;
}

function createCallbackProxies(
  callbackShape: string,
  latestRoot: MutableValueRef
): ReadonlyMap<string, AnyFunction> {
  const paths = JSON.parse(callbackShape) as string[][];
  return new Map(paths.map((path) => {
    const proxy: AnyFunction = (...args) => {
      const callback = valueAtPath(latestRoot.current, path);
      if (typeof callback !== "function") {
        throw new Error(`Stable composition callback is unavailable at ${path.join(".")}`);
      }
      return Reflect.apply(callback, undefined, args);
    };
    return [pathKey(path), proxy];
  }));
}

function stabilizeNode(
  current: unknown,
  previous: unknown,
  latestRoot: MutableValueRef,
  callbackProxies: ReadonlyMap<string, AnyFunction>,
  path: string[]
): unknown {
  if (typeof current === "function") {
    const proxy = callbackProxies.get(pathKey(path));
    if (!proxy) {
      throw new Error(`Stable composition callback shape is missing ${path.join(".")}`);
    }
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

function callbackPathSignature(root: Record<string, unknown>): string {
  const paths: string[][] = [];
  collectCallbackPaths(root, [], paths, new Set<object>());
  return JSON.stringify(paths);
}

function collectCallbackPaths(
  current: Record<string, unknown>,
  path: string[],
  paths: string[][],
  ancestors: Set<object>
) {
  if (ancestors.has(current)) {
    throw new Error("Stable plain-object composition requires an acyclic tree");
  }
  ancestors.add(current);
  for (const [key, child] of Object.entries(current)) {
    const childPath = [...path, key];
    if (typeof child === "function") paths.push(childPath);
    else if (isPlainObject(child)) collectCallbackPaths(child, childPath, paths, ancestors);
  }
  ancestors.delete(current);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pathKey(path: string[]): string {
  return path.join("\u0000");
}

function valueAtPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}
