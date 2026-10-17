import type { Graph } from 'falkordb';

export const FIXTURE_SEED_LOCK_TTL_MS = 30_000;
const fixtureSeedLockId = 'official-csv-launch';

export interface FixtureSeedLease {
  ownerId: string;
  fence: number;
}

export async function acquireFixtureSeedLock(graph: Graph, ownerId: string): Promise<FixtureSeedLease | undefined> {
  const result = await graph.query<unknown[]>(`
MERGE (lock:FixtureSeedLock {id: $lockId})
WITH lock
WHERE coalesce(lock.leaseUntil, 0) <= timestamp()
SET lock.owner = $ownerId, lock.leaseUntil = timestamp() + $ttlMs,
    lock.fence = coalesce(lock.fence, 0) + 1
RETURN lock.fence AS fence`, {
    params: { lockId: fixtureSeedLockId, ownerId, ttlMs: FIXTURE_SEED_LOCK_TTL_MS },
  });
  const fence = firstNumber(result.data);
  return fence === undefined ? undefined : { ownerId, fence };
}

export async function renewFixtureSeedLock(graph: Graph, lease: FixtureSeedLease): Promise<boolean> {
  const result = await graph.query<unknown[]>(`
MATCH (lock:FixtureSeedLock {id: $lockId, owner: $ownerId, fence: $fence})
WHERE lock.leaseUntil > timestamp()
SET lock.leaseUntil = timestamp() + $ttlMs
RETURN lock.fence AS fence`, {
    params: {
      lockId: fixtureSeedLockId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      ttlMs: FIXTURE_SEED_LOCK_TTL_MS,
    },
  });
  return firstNumber(result.data) === lease.fence;
}

export async function releaseFixtureSeedLock(graph: Graph, lease: FixtureSeedLease): Promise<void> {
  await graph.query(`
MATCH (lock:FixtureSeedLock {id: $lockId, owner: $ownerId, fence: $fence})
SET lock.owner = null, lock.leaseUntil = 0`, {
    params: { lockId: fixtureSeedLockId, ownerId: lease.ownerId, fence: lease.fence },
  });
}

export function fixtureSeedWriteGuard(lease: FixtureSeedLease): { query: string; params: Record<string, string | number> } {
  return {
    query: `MATCH (lock:FixtureSeedLock {id: $seedLockId, owner: $seedLockOwnerId, fence: $seedLockFence})
WHERE lock.leaseUntil > timestamp()
WITH lock`,
    params: {
      seedLockId: fixtureSeedLockId,
      seedLockOwnerId: lease.ownerId,
      seedLockFence: lease.fence,
    },
  };
}

function firstNumber(rows: unknown[] | undefined): number | undefined {
  const first = rows?.[0];
  const value = Array.isArray(first)
    ? first[0]
    : typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>).fence
      : undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
