import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import { expandDemoRollout, isFixtureReady, restoreDemoRollout, seedFixture, seedFixtureIfMissing, setDemoTestAvailability } from './fixture.js';
import {
  acquireFixtureSeedLock,
  FIXTURE_SEED_LOCK_TTL_MS,
  fixtureSeedWriteGuard,
  releaseFixtureSeedLock,
  renewFixtureSeedLock,
} from './fixture-lock.js';

test('fixture seed lock fences an expired owner after another process takes over', async () => {
  let current: { owner: string; fence: number; leaseUntil: number } | undefined;
  const graph = {
    async query(query: string, options?: { params?: Record<string, string | number> }) {
      const params = options?.params ?? {};
      if (query.includes('MERGE (lock:FixtureSeedLock')) {
        const ownerId = String(params.ownerId);
        if (!current || current.leaseUntil <= Date.now()) {
          current = {
            owner: ownerId,
            fence: (current?.fence ?? 0) + 1,
            leaseUntil: Date.now() + FIXTURE_SEED_LOCK_TTL_MS,
          };
          return { data: [[current.fence]] };
        }
        return { data: [] };
      }
      if (query.includes('SET lock.owner = null')) {
        if (current?.owner === String(params.ownerId) && current.fence === Number(params.fence)) {
          current.leaseUntil = 0;
        }
        return { data: [] };
      }
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) {
        if (current?.owner === String(params.ownerId)
          && current.fence === Number(params.fence)
          && current.leaseUntil > Date.now()) {
          current.leaseUntil = Date.now() + FIXTURE_SEED_LOCK_TTL_MS;
          return { data: [[current.fence]] };
        }
        return { data: [] };
      }
      throw new Error(`Unexpected fixture lock query: ${query}`);
    },
  } as unknown as Graph;

  const first = await acquireFixtureSeedLock(graph, 'process-a');
  assert.ok(first);
  assert.equal(await acquireFixtureSeedLock(graph, 'process-b'), undefined);

  assert.ok(current);
  current.leaseUntil = Date.now() - 1;
  const second = await acquireFixtureSeedLock(graph, 'process-b');
  assert.ok(second);
  assert.ok(second.fence > first.fence);
  assert.equal(await renewFixtureSeedLock(graph, first), false);
  const staleWrite = fixtureSeedWriteGuard(first);
  assert.match(staleWrite.query, /WHERE lock\.leaseUntil > timestamp\(\)/);
  assert.equal(staleWrite.params.seedLockFence, first.fence);

  await releaseFixtureSeedLock(graph, second);

  assert.equal(await renewFixtureSeedLock(graph, first), false);
  const third = await acquireFixtureSeedLock(graph, 'process-c');
  assert.ok(third);
  assert.ok(third.fence > second.fence);
});

test('fixture reads wait for the active seed and only report ready after its marker is written', async () => {
  let releaseInitialCheck!: (result: { data: unknown[] }) => void;
  const initialCheck = new Promise<{ data: unknown[] }>((resolve) => {
    releaseInitialCheck = resolve;
  });
  let firstStateCheck = true;
  let markerWritten = false;
  const graph = {
    async query(query: string) {
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
      if (query.includes('MATCH (state:FixtureState')) {
        if (firstStateCheck) {
          firstStateCheck = false;
          return initialCheck;
        }
        return { data: markerWritten ? [['official-csv-launch']] : [] };
      }
      if (query.includes('MERGE (state:FixtureState')) markerWritten = true;
      return { data: [] };
    },
  } as unknown as Graph;

  const seeding = seedFixtureIfMissing(graph);
  let readinessResolved = false;
  const readiness = isFixtureReady(graph).then((ready) => {
    readinessResolved = true;
    return ready;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(readinessResolved, false);

  releaseInitialCheck({ data: [] });
  await seeding;
  assert.equal(await readiness, true);
});

test('fixture readiness is false until the current version marker exists', async () => {
  let requestedVersion = '';
  const graph = {
    async query(_query: string, options?: { params?: Record<string, unknown> }) {
      requestedVersion = String(options?.params?.version ?? '');
      return { data: [] };
    },
  } as unknown as Graph;
  assert.equal(await isFixtureReady(graph), false);
  assert.equal(requestedVersion, 'csv-launch-v9');
});

test('fixture version upgrade reseeds a previously completed v4 campaign', async () => {
  let markerVersion = 'csv-launch-v4';
  let completionWrites = 0;
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      const params = options?.params ?? {};
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
      if (query.includes('MATCH (state:FixtureState')) {
        return { data: markerVersion === params.version ? [['official-csv-launch']] : [] };
      }
      if (query.includes('MERGE (state:FixtureState')) {
        markerVersion = String(params.version);
        completionWrites += 1;
      }
      return { data: [] };
    },
  } as unknown as Graph;

  await seedFixtureIfMissing(graph);

  assert.equal(markerVersion, 'csv-launch-v9');
  assert.equal(completionWrites, 1);
});

test('fixture reseeding replaces proposal-edited draft relationships with canonical paths', async () => {
  const queries: string[] = [];
  const promiseNodes = new Set(['promise-all-accounts', 'promise-testers', 'promise-proposal', 'promise-email-proposal', 'promise-shared']);
  const relationships = new Map<string, Set<string>>([
    ['draft-landing', new Set(['MAKES_PROMISE:promise-proposal'])],
    ['draft-email', new Set(['MAKES_PROMISE:promise-email-proposal', 'MAKES_PROMISE:promise-shared', 'REUSES_DRAFT:draft-social'])],
    ['draft-other', new Set(['MAKES_PROMISE:promise-shared'])],
  ]);
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      queries.push(query);
      const params = options?.params ?? {};
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
      if (query.includes('DELETE link')) {
        const relationshipType = query.match(/\[link:([A-Z_]+)\]/)?.[1];
        assert.ok(relationshipType, 'fixture cleanup query should name one relationship type');
        const draftIds = params.draftIds as string[];
        const canonicalPromiseIds = new Set(params.canonicalPromiseIds as string[] | undefined);
        for (const draftId of draftIds) {
          const outgoing = relationships.get(draftId);
          if (!outgoing) continue;
          for (const relationship of outgoing) {
            if (relationship.startsWith(`${relationshipType}:`)) {
              outgoing.delete(relationship);
              if (relationshipType === 'MAKES_PROMISE' && query.includes('DETACH DELETE promise')) {
                const promiseId = relationship.slice('MAKES_PROMISE:'.length);
                const stillOwned = [...relationships.values()].some((edges) => edges.has(`MAKES_PROMISE:${promiseId}`));
                if (!canonicalPromiseIds.has(promiseId) && !stillOwned) promiseNodes.delete(promiseId);
              }
            }
          }
        }
        return { data: [] };
      }
      if (query.includes('UNWIND $edges AS edge')) {
        const type = query.match(/MERGE \(source\)-\[:([A-Z_]+)\]->\(target\)/)?.[1];
        assert.ok(type, 'fixture edge query should name its relationship type');
        for (const edge of params.edges as Array<{ from: string; to: string }>) {
          const outgoing = relationships.get(edge.from) ?? new Set<string>();
          outgoing.add(`${type}:${edge.to}`);
          relationships.set(edge.from, outgoing);
        }
      }
      if (query.includes('DETACH DELETE promise')) return { data: [] };
      return { data: [] };
    },
  } as unknown as Graph;

  await seedFixture(graph, { ownerId: 'fixture-reseed-test', fence: 1 });

  assert.deepEqual(
    [...relationships.get('draft-landing') ?? []].filter((relationship) => relationship.startsWith('MAKES_PROMISE:') || relationship.startsWith('REUSES_DRAFT:')),
    ['MAKES_PROMISE:promise-all-accounts'],
  );
  assert.deepEqual(
    [...relationships.get('draft-email') ?? []].filter((relationship) => relationship.startsWith('MAKES_PROMISE:') || relationship.startsWith('REUSES_DRAFT:')),
    ['REUSES_DRAFT:draft-landing'],
  );
  assert.equal(promiseNodes.has('promise-proposal'), false);
  assert.equal(promiseNodes.has('promise-email-proposal'), false);
  assert.equal(promiseNodes.has('promise-all-accounts'), true);
  assert.equal(promiseNodes.has('promise-shared'), true);
  const cleanupQueries = queries.filter((query) => query.includes('DELETE link'));
  assert.deepEqual(cleanupQueries.map((query) => query.match(/\[link:([A-Z_]+)\]/)?.[1]), ['MAKES_PROMISE', 'REUSES_DRAFT']);
  assert.match(cleanupQueries[0] ?? '', /OPTIONAL MATCH \(:Draft\)-\[remainingOwner:MAKES_PROMISE\]->\(promise\)/);
  assert.match(cleanupQueries[0] ?? '', /DETACH DELETE promise/);
});

test('a failed seed completion does not advance the fact revision before a successful retry', async () => {
  let factRevision = 4;
  let markerWritten = false;
  let failCompletionOnce = true;
  const graph = {
    async query(query: string) {
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
      if (query.includes('MATCH (state:FixtureState')) return { data: markerWritten ? [['official-csv-launch']] : [] };
      if (query.includes('MERGE (state:FixtureState')) {
        assert.match(query, /SET feature\.factsRevision = coalesce\(feature\.factsRevision, 0\) \+ 1/);
        if (failCompletionOnce) {
          failCompletionOnce = false;
          throw new Error('simulated completion failure');
        }
        factRevision += 1;
        markerWritten = true;
      }
      return { data: [] };
    },
  } as unknown as Graph;

  await assert.rejects(seedFixtureIfMissing(graph), /simulated completion failure/);
  assert.equal(factRevision, 4);
  assert.equal(markerWritten, false);

  await seedFixtureIfMissing(graph);
  assert.equal(factRevision, 5);
  assert.equal(markerWritten, true);
});

test('repeating the S4 demo rollout does not create a second event or fact revision', async () => {
  let rolloutIsCurrent = false;
  let expansionEvents = 0;
  let factRevisionIncrements = 0;
  const graph = {
    async query(query: string) {
      if (query.includes('WHERE coalesce(old.current, false) = true')) {
        const condition = query.indexOf('WHERE coalesce(old.current, false) = true');
        const merge = query.indexOf('MERGE (rollout:Rollout');
        assert.ok(condition >= 0 && condition < merge, 'the source-state guard must run before creating the target rollout');
        if (rolloutIsCurrent) return { data: [] };
        rolloutIsCurrent = true;
        expansionEvents += 1;
        factRevisionIncrements += 1;
        assert.match(query, /CREATE \(event:ActivityEvent \{id: \$eventId, campaignId: \$campaignId, kind: 'rollout\.expanded'/);
        return { data: [['rollout-all-accounts', 'event-1']] };
      }
      if (query.includes("current: true")) {
        return { data: rolloutIsCurrent ? [['rollout-all-accounts']] : [] };
      }
      return { data: [] };
    },
  } as unknown as Graph;

  await expandDemoRollout(graph);
  await expandDemoRollout(graph);

  assert.equal(expansionEvents, 1);
  assert.equal(factRevisionIncrements, 1);
});

test('demo rollout fails if it neither transitions nor finds the expected current rollout', async () => {
  const graph = { async query() { return { data: [] }; } } as unknown as Graph;
  await assert.rejects(expandDemoRollout(graph), /could not be updated in the graph/);
});

test('a malformed prior S4 state does not create an orphan rollout', async () => {
  const queries: string[] = [];
  const graph = {
    async query(query: string) {
      queries.push(query);
      return { data: [] };
    },
  } as unknown as Graph;

  await assert.rejects(expandDemoRollout(graph), /could not be updated in the graph/);
  const transition = queries[0];
  const existingLookup = transition.indexOf('OPTIONAL MATCH (existingRollout:Rollout');
  const stateGuard = transition.indexOf('WHERE coalesce(old.current, false) = true');
  const targetMerge = transition.indexOf('MERGE (rollout:Rollout');
  assert.ok(existingLookup >= 0 && existingLookup < stateGuard && stateGuard < targetMerge);
});

test('rollout demo can restore tester-only access and records only real transitions', async () => {
  let expanded = true;
  let events = 0;
  let factRevision = 3;
  const graph = {
    async query(query: string) {
      if (query.includes("kind: 'rollout.restored'")) {
        assert.match(query, /coalesce\(expanded\.current, false\) = true AND coalesce\(baseline\.current, false\) = false/);
        assert.match(query, /FOREACH \(source IN sources \| SET source\.observedAt = \$observedAt\)/);
        assert.match(query, /feature\.factsRevision = coalesce\(feature\.factsRevision, 0\) \+ 1/);
        if (!expanded) return { data: [] };
        expanded = false;
        events += 1;
        factRevision += 1;
        return { data: [['rollout-testers-only', `event-${events}`]] };
      }
      if (query.includes('expanded:Rollout {id: $expandedRolloutId, current: false}')) {
        return { data: !expanded ? [['rollout-testers-only']] : [] };
      }
      throw new Error(`Unexpected rollout restore query: ${query}`);
    },
  } as unknown as Graph;

  await restoreDemoRollout(graph);
  await restoreDemoRollout(graph);

  assert.equal(expanded, false);
  assert.equal(events, 1);
  assert.equal(factRevision, 4);
});

test('rollout restore fails if the graph is not in the expanded or baseline state', async () => {
  const graph = { async query() { return { data: [] }; } } as unknown as Graph;
  await assert.rejects(restoreDemoRollout(graph), /could not be restored in the graph/);
});

test('missing-test demo scenario is reversible and only advances facts for real transitions', async () => {
  let testAvailable = true;
  let factRevision = 2;
  let scenarioEvents = 0;
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      const params = options?.params ?? {};
      if (query.includes('CREATE (event:ActivityEvent') && query.includes("kind: 'demo.test_scenario.changed'")) {
        assert.match(query, /WHERE coalesce\(test\.current, false\) <> \$available/);
        assert.match(query, /feature\.factsRevision = coalesce\(feature\.factsRevision, 0\) \+ 1/);
        assert.match(query, /FOREACH \(source IN sources \| SET source\.observedAt = \$observedAt\)/);
        if (testAvailable === params.available) return { data: [] };
        testAvailable = Boolean(params.available);
        factRevision += 1;
        scenarioEvents += 1;
        return { data: [['test-csv-r17', `event-${scenarioEvents}`]] };
      }
      if (query.includes('current: $available')) {
        return { data: testAvailable === params.available ? [['test-csv-r17']] : [] };
      }
      throw new Error(`Unexpected demo test scenario query: ${query}`);
    },
  } as unknown as Graph;

  await setDemoTestAvailability(graph, false);
  assert.equal(testAvailable, false);
  assert.equal(factRevision, 3);
  await setDemoTestAvailability(graph, false);
  assert.equal(scenarioEvents, 1);
  assert.equal(factRevision, 3);
  await setDemoTestAvailability(graph, true);
  assert.equal(testAvailable, true);
  assert.equal(scenarioEvents, 2);
  assert.equal(factRevision, 4);
});
