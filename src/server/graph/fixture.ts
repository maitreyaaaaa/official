import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Graph } from 'falkordb';
import {
  acquireFixtureSeedLock,
  FIXTURE_SEED_LOCK_TTL_MS,
  fixtureSeedWriteGuard,
  releaseFixtureSeedLock,
  renewFixtureSeedLock,
  type FixtureSeedLease,
} from './fixture-lock.js';

interface FixtureEdge {
  type: string;
  from: string;
  to: string;
}

interface FixtureData {
  nodes: Record<string, Array<Record<string, string | number | boolean>>>;
  edges: FixtureEdge[];
}

type FixtureQueryParam = string | number | boolean | string[] | Array<Record<string, string | number | boolean>>;

const fixturePath = fileURLToPath(new URL('../../../data/fixtures/csv-launch.json', import.meta.url));
const allowedLabels = ['Campaign', 'Draft', 'Promise', 'Feature', 'Audience', 'Deployment', 'Rollout', 'Test', 'Source'] as const;
const fixtureVersion = 'csv-launch-v7';
let seedInProgress: Promise<void> | undefined;
const fixtureLockWaitMs = FIXTURE_SEED_LOCK_TTL_MS * 2 + 5_000;

const edgeQueries: Record<string, { from: string; to: string }> = {
  IN_CAMPAIGN: { from: 'Draft', to: 'Campaign' },
  MAKES_PROMISE: { from: 'Draft', to: 'Promise' },
  REUSES_DRAFT: { from: 'Draft', to: 'Draft' },
  ABOUT: { from: 'Promise', to: 'Feature' },
  TARGETS: { from: 'Promise', to: 'Audience' },
  RUNNING_AS: { from: 'Feature', to: 'Deployment' },
  HAS_ROLLOUT: { from: 'Feature', to: 'Rollout' },
  HAS_TEST: { from: 'Feature', to: 'Test' },
  INCLUDES: { from: 'Rollout', to: 'Audience' },
  EXCLUDES: { from: 'Rollout', to: 'Audience' },
  HAS_SOURCE: { from: 'Deployment|Rollout|Test', to: 'Source' },
};

export async function seedFixture(graph: Graph, lease: FixtureSeedLease): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureData;
  const observedAt = new Date().toISOString();

  await writeFixtureQuery(graph, lease,
    'MATCH (rollout:Rollout {id: $rolloutId}) SET rollout.current = false',
    { rolloutId: 'rollout-all-accounts' },
  );

  for (const label of allowedLabels) {
    const records = (fixture.nodes[label] ?? []).map((record) => (
      Object.hasOwn(record, 'observedAt') ? { ...record, observedAt } : record
    ));
    if (!records.length) continue;
    await writeFixtureQuery(graph, lease,
      `UNWIND $records AS record MERGE (node:${label} {id: record.id}) SET node += record`,
      { records },
    );
  }

  const fixtureDraftIds = (fixture.nodes.Draft ?? [])
    .map((record) => record.id)
    .filter((id): id is string => typeof id === 'string');
  const canonicalPromiseIds = (fixture.nodes.Promise ?? [])
    .map((record) => record.id)
    .filter((id): id is string => typeof id === 'string');
  await writeFixtureQuery(graph, lease, `
MATCH (draft:Draft)-[link:MAKES_PROMISE]->(promise:Promise)
WHERE draft.id IN $draftIds
WITH promise, collect(link) AS ownerLinks
FOREACH (link IN ownerLinks | DELETE link)
WITH DISTINCT promise
WHERE NOT promise.id IN $canonicalPromiseIds
OPTIONAL MATCH (:Draft)-[remainingOwner:MAKES_PROMISE]->(promise)
WITH promise, count(remainingOwner) AS ownerCount
WHERE ownerCount = 0
DETACH DELETE promise`,
  { draftIds: fixtureDraftIds, canonicalPromiseIds },
  );
  await writeFixtureQuery(graph, lease,
    'MATCH (draft:Draft)-[link:REUSES_DRAFT]->() WHERE draft.id IN $draftIds DELETE link',
    { draftIds: fixtureDraftIds },
  );

  for (const [type, endpoints] of Object.entries(edgeQueries)) {
    const edges = fixture.edges.filter((edge) => edge.type === type);
    if (!edges.length) continue;
    const fromLabels = endpoints.from.split('|');
    for (const label of fromLabels) {
      const labeledEdges = edges.filter((edge) => fixture.nodes[label]?.some((node) => node.id === edge.from));
      if (!labeledEdges.length) continue;
      const edgeParams: Record<string, string>[] = labeledEdges.map((edge) => ({ from: edge.from, to: edge.to }));
      await writeFixtureQuery(graph, lease,
        `UNWIND $edges AS edge MATCH (source:${label} {id: edge.from}), (target:${endpoints.to} {id: edge.to}) MERGE (source)-[:${type}]->(target)`,
        { edges: edgeParams },
      );
    }
  }

  await writeFixtureQuery(graph, lease,
    `MATCH (feature:Feature {id: $featureId})
SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1
MERGE (state:FixtureState {id: $id})
SET state.version = $version, state.completedAt = $completedAt`,
    {
      featureId: 'feature-csv-export',
      id: 'official-csv-launch',
      version: fixtureVersion,
      completedAt: new Date().toISOString(),
    },
  );
}

export function seedFixtureIfMissing(graph: Graph): Promise<void> {
  if (!seedInProgress) {
    seedInProgress = (async () => {
      if (await hasFixtureMarker(graph)) return;

      const ownerId = randomUUID();
      const deadline = Date.now() + fixtureLockWaitMs;
      while (true) {
        const lease = await acquireFixtureSeedLock(graph, ownerId);
        if (lease) {
          try {
            // Another process may have finished between our marker check and lock acquisition.
            if (await hasFixtureMarker(graph)) return;
            await seedFixture(graph, lease);
            if (!await hasFixtureMarker(graph)) {
              throw new Error('Fixture initialization finished without writing its completion marker.');
            }
            return;
          } finally {
            try {
              await releaseFixtureSeedLock(graph, lease);
            } catch {
              // The lease expires automatically if the graph cannot release it.
            }
          }
        }

        if (await hasFixtureMarker(graph)) return;
        if (Date.now() >= deadline) {
          throw new Error('Timed out waiting for another process to initialize the graph fixture.');
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    })().finally(() => {
      seedInProgress = undefined;
    });
  }
  return seedInProgress;
}

export async function isFixtureReady(graph: Graph): Promise<boolean> {
  if (seedInProgress) await seedInProgress;
  return hasFixtureMarker(graph);
}

async function hasFixtureMarker(graph: Graph): Promise<boolean> {
  const result = await graph.query<unknown[]>(
    'MATCH (state:FixtureState {id: $id, version: $version}) RETURN state.id LIMIT 1',
    { params: { id: 'official-csv-launch', version: fixtureVersion } },
  );
  return Boolean(result.data?.length);
}

async function writeFixtureQuery(
  graph: Graph,
  lease: FixtureSeedLease,
  query: string,
  params: Record<string, FixtureQueryParam>,
): Promise<void> {
  if (!await renewFixtureSeedLock(graph, lease)) {
    throw new Error('Lost the graph fixture seed lock before a write.');
  }

  const guard = fixtureSeedWriteGuard(lease);
  await graph.query(`${guard.query}\n${query}`, {
    params: { ...guard.params, ...params },
  });

  if (!await renewFixtureSeedLock(graph, lease)) {
    throw new Error('Lost the graph fixture seed lock during a write.');
  }
}

export async function expandDemoRollout(graph: Graph): Promise<void> {
  const query = `
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(old:Rollout {id: $oldRolloutId})
MATCH (allAccounts:Audience {id: $allAccountsId})
MATCH (testers:Audience {id: $testersId})
OPTIONAL MATCH (existingRollout:Rollout {id: $rolloutId})
WITH feature, old, allAccounts, testers, existingRollout
WHERE coalesce(old.current, false) = true AND coalesce(existingRollout.current, false) = false
MERGE (rollout:Rollout {id: $rolloutId})
WITH feature, old, allAccounts, testers, rollout
SET old.current = false
SET rollout.name = $rolloutName, rollout.environment = $environment,
    rollout.reviewed = true, rollout.current = true, rollout.observedAt = $observedAt
SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1
MERGE (source:Source {id: $sourceId})
SET source.label = $sourceLabel, source.text = $sourceText,
    source.reviewedBy = $reviewedBy, source.observedAt = $observedAt
MERGE (feature)-[:HAS_ROLLOUT]->(rollout)
MERGE (rollout)-[:INCLUDES]->(allAccounts)
MERGE (rollout)-[:INCLUDES]->(testers)
MERGE (rollout)-[:HAS_SOURCE]->(source)
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'rollout.expanded', occurredAt: $observedAt, title: 'Synthetic rollout expanded', detail: 'The local scenario now includes all customer accounts.'})
RETURN rollout.id AS rolloutId, event.id AS eventId`;

  const result = await graph.query(query, {
    params: {
      featureId: 'feature-csv-export',
      oldRolloutId: 'rollout-testers-only',
      allAccountsId: 'audience-all-accounts',
      testersId: 'audience-internal-testers',
      rolloutId: 'rollout-all-accounts',
      rolloutName: 'All-account rollout',
      environment: 'production',
      observedAt: new Date().toISOString(),
      sourceId: 'source-s4',
      sourceLabel: 'S4 · Rollout expanded',
      sourceText: 'CSV export is enabled for all customer accounts, including internal testers.',
      reviewedBy: 'Product teammate',
      eventId: randomUUID(),
      campaignId: 'campaign-csv-launch',
    },
  });

  if (!result.data?.length) {
    const current = await graph.query<unknown[]>(`
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(rollout:Rollout {id: $rolloutId, current: true})
MATCH (feature)-[:HAS_ROLLOUT]->(:Rollout {id: $oldRolloutId, current: false})
MATCH (rollout)-[:INCLUDES]->(:Audience {id: $allAccountsId})
MATCH (rollout)-[:INCLUDES]->(:Audience {id: $testersId})
MATCH (rollout)-[:HAS_SOURCE]->(:Source {id: $sourceId})
RETURN rollout.id AS rolloutId LIMIT 1`, {
      params: {
        featureId: 'feature-csv-export',
        oldRolloutId: 'rollout-testers-only',
        rolloutId: 'rollout-all-accounts',
        allAccountsId: 'audience-all-accounts',
        testersId: 'audience-internal-testers',
        sourceId: 'source-s4',
      },
    });
    if (!current.data?.length) throw new Error('The fictional rollout could not be updated in the graph.');
  }
}

export async function restoreDemoRollout(graph: Graph): Promise<void> {
  const observedAt = new Date().toISOString();
  const query = `
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(expanded:Rollout {id: $expandedRolloutId})
MATCH (feature)-[:HAS_ROLLOUT]->(baseline:Rollout {id: $baselineRolloutId})
OPTIONAL MATCH (baseline)-[:HAS_SOURCE]->(source:Source)
WITH feature, expanded, baseline, collect(source) AS sources
WHERE coalesce(expanded.current, false) = true AND coalesce(baseline.current, false) = false
SET expanded.current = false, baseline.current = true, baseline.observedAt = $observedAt
FOREACH (source IN sources | SET source.observedAt = $observedAt)
SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'rollout.restored',
       occurredAt: $observedAt, title: 'Synthetic rollout restored', detail: 'The local scenario again limits CSV export to internal testers.'})
CREATE (feature)-[:HAS_EVENT]->(event)
RETURN baseline.id AS rolloutId, event.id AS eventId`;
  const transition = await graph.query<Record<string, unknown>>(query, {
    params: {
      featureId: 'feature-csv-export',
      expandedRolloutId: 'rollout-all-accounts',
      baselineRolloutId: 'rollout-testers-only',
      observedAt,
      eventId: randomUUID(),
      campaignId: 'campaign-csv-launch',
    },
  });
  if (transition.data?.length) return;

  const current = await graph.query<unknown[]>(`
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(expanded:Rollout {id: $expandedRolloutId, current: false})
MATCH (feature)-[:HAS_ROLLOUT]->(baseline:Rollout {id: $baselineRolloutId, current: true})
MATCH (baseline)-[:INCLUDES]->(:Audience {id: $testersId})
MATCH (baseline)-[:EXCLUDES]->(:Audience {id: $allAccountsId})
RETURN baseline.id AS rolloutId LIMIT 1`, {
    params: {
      featureId: 'feature-csv-export',
      expandedRolloutId: 'rollout-all-accounts',
      baselineRolloutId: 'rollout-testers-only',
      testersId: 'audience-internal-testers',
      allAccountsId: 'audience-all-accounts',
    },
  });
  if (!current.data?.length) throw new Error('The fictional rollout could not be restored in the graph.');
}

export async function setDemoTestAvailability(graph: Graph, available: boolean): Promise<void> {
  const observedAt = new Date().toISOString();
  const query = `
MATCH (feature:Feature {id: $featureId})-[:HAS_TEST]->(test:Test {id: $testId})
OPTIONAL MATCH (test)-[:HAS_SOURCE]->(source:Source)
WITH feature, test, collect(source) AS sources
WHERE coalesce(test.current, false) <> $available
SET test.current = $available
FOREACH (source IN sources | SET source.observedAt = $observedAt)
SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'demo.test_scenario.changed',
       occurredAt: $observedAt, title: $title, detail: $detail})
CREATE (feature)-[:HAS_EVENT]->(event)
RETURN test.id AS testId, event.id AS eventId`;
  const transition = await graph.query<Record<string, unknown>>(query, {
    params: {
      featureId: 'feature-csv-export',
      testId: 'test-csv-r17',
      available,
      observedAt,
      eventId: randomUUID(),
      campaignId: 'campaign-csv-launch',
      title: available ? 'Synthetic test restored' : 'Synthetic test result removed',
      detail: available
        ? 'The local scenario restored the reviewed production test result for CSV export.'
        : 'The local scenario removed the current production test result to demonstrate an Unknown finding.',
    },
  });
  if (transition.data?.length) return;

  const current = await graph.query<unknown[]>(`
MATCH (:Feature {id: $featureId})-[:HAS_TEST]->(test:Test {id: $testId, current: $available})
RETURN test.id AS testId LIMIT 1`, {
    params: { featureId: 'feature-csv-export', testId: 'test-csv-r17', available },
  });
  if (!current.data?.length) throw new Error('The fictional test scenario could not be updated in the graph.');
}
