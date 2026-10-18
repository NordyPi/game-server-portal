import "server-only";

// One change at a time per server, so two friends clicking "Apply" together can't interleave
// config writes and restarts.

const g = globalThis as unknown as { __instanceLocks?: Map<string, Promise<unknown>> };
const locks = (g.__instanceLocks ??= new Map());

export function withInstanceLock<T>(instanceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(instanceId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(instanceId, next);
  return next;
}
