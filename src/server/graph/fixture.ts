import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Graph } from 'falkordb';

interface FixtureEdge {
  type: string;
  from: string;
  to: string;
}

interface FixtureData {
  nodes: Record<string, Array<Record<string, string | number | boolean>>>;
  edges: FixtureEdge[];
}

const fixturePath = fileURLToPath(new URL('../../../data/fixtures/csv-launch.json', import.meta.url));
const allowedLabels = ['Campaign', 'Draft', 'Promise', 'Feature', 'Audience', 'Deployment', 'Rollout', 'Test', 'Source'] as const;
const fixtureVersion = 'csv-launch-v2';
let seedInProgress: Promise<void> | undefined;

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

export async function seedFixture(graph: Graph): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureData;
  const observedAt = new Date().toISOString();

  await graph.query(
    'MATCH (rollout:Rollout {id: $rolloutId}) SET rollout.current = false',
    { params: { rolloutId: 'rollout-all-accounts' } },
  );

  for (const label of allowedLabels) {
    const records = (fixture.nodes[label] ?? []).map((record) => (
      Object.hasOwn(record, 'observedAt') ? { ...record, observedAt } : record
    ));
    if (!records.length) continue;
    await graph.query(
      `UNWIND $records AS record MERGE (node:${label} {id: record.id}) SET node += record`,
      { params: { records } },
    );
  }

  for (const [type, endpoints] of Object.entries(edgeQueries)) {
    const edges = fixture.edges.filter((edge) => edge.type === type);
    if (!edges.length) continue;
    const fromLabels = endpoints.from.split('|');
    for (const label of fromLabels) {
      const labeledEdges = edges.filter((edge) => fixture.nodes[label]?.some((node) => node.id === edge.from));
      if (!labeledEdges.length) continue;
      const edgeParams: Record<string, string>[] = labeledEdges.map((edge) => ({ from: edge.from, to: edge.to }));
      await graph.query(
        `UNWIND $edges AS edge MATCH (source:${label} {id: edge.from}), (target:${endpoints.to} {id: edge.to}) MERGE (source)-[:${type}]->(target)`,
        { params: { edges: edgeParams } },
      );
    }
  }

  await graph.query(
    `MERGE (state:FixtureState {id: $id}) SET state.version = $version, state.completedAt = $completedAt`,
    { params: { id: 'official-csv-launch', version: fixtureVersion, completedAt: new Date().toISOString() } },
  );
}

export function seedFixtureIfMissing(graph: Graph): Promise<void> {
  if (!seedInProgress) {
    seedInProgress = (async () => {
      const seedState = await graph.query<unknown[]>(
        'MATCH (state:FixtureState {id: $id, version: $version}) RETURN state.id LIMIT 1',
        { params: { id: 'official-csv-launch', version: fixtureVersion } },
      );
      if (seedState.data?.length) return;
      await seedFixture(graph);
    })().finally(() => {
      seedInProgress = undefined;
    });
  }
  return seedInProgress;
}

export async function expandDemoRollout(graph: Graph): Promise<void> {
  const query = `
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(old:Rollout {id: $oldRolloutId})
MATCH (allAccounts:Audience {id: $allAccountsId})
MATCH (testers:Audience {id: $testersId})
SET old.current = false
MERGE (rollout:Rollout {id: $rolloutId})
SET rollout.name = $rolloutName, rollout.environment = $environment,
    rollout.reviewed = true, rollout.current = true, rollout.observedAt = $observedAt
MERGE (source:Source {id: $sourceId})
SET source.label = $sourceLabel, source.text = $sourceText,
    source.reviewedBy = $reviewedBy, source.observedAt = $observedAt
MERGE (feature)-[:HAS_ROLLOUT]->(rollout)
MERGE (rollout)-[:INCLUDES]->(allAccounts)
MERGE (rollout)-[:INCLUDES]->(testers)
MERGE (rollout)-[:HAS_SOURCE]->(source)
RETURN rollout.id`;

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
    },
  });

  if (!result.data?.length) {
    throw new Error('The fictional rollout could not be updated in the graph.');
  }
}
