export function withoutSetValue<T>(current: Set<T>, value: T): Set<T> {
  const next = new Set(current);
  next.delete(value);
  return next;
}

export function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
}
