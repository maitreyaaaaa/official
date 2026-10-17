import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Graph } from 'falkordb';
import { defaultDemoCompany, demoCompanies, demoCompanyByCampaignId, type DemoCompany } from '../../shared/demo-companies.js';
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

interface ConnectedFixtureData {
  company: Record<string, string>;
  people: Array<Record<string, string>>;
  project: Record<string, string>;
  processes: Array<Record<string, string | number | boolean>>;
  decision: Record<string, string>;
  notes: Array<Record<string, string>>;
  noteLinks: Array<[string, string]>;
  sourceLinks: Array<[string, string]>;
  instructions: Array<Record<string, string | number>>;
  task: Record<string, string>;
  handoff: Record<string, string | number>;
  episode: Record<string, string>;
}

type FixtureQueryParam = string | number | boolean | string[] | Array<Record<string, string | number | boolean>>;

const fixturePath = fileURLToPath(new URL('../../../data/fixtures/csv-launch.json', import.meta.url));
const connectedFixturePath = fileURLToPath(new URL('../../../data/fixtures/connected-workspace.json', import.meta.url));
const northstarFixturePath = fileURLToPath(new URL('../../../data/fixtures/northstar-launch.json', import.meta.url));
const northstarConnectedFixturePath = fileURLToPath(new URL('../../../data/fixtures/northstar-workspace.json', import.meta.url));
const allowedLabels = ['Campaign', 'Draft', 'Promise', 'Feature', 'Audience', 'Deployment', 'Rollout', 'Test', 'Source', 'Company', 'Person', 'Project', 'Process', 'Decision', 'KnowledgeNote', 'InstructionVersion', 'Task', 'Handoff', 'ReviewEpisode'] as const;
const fixtureVersion = 'connected-companies-v11';
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
  HAS_PROJECT: { from: 'Company', to: 'Project' },
  RUNS_CAMPAIGN: { from: 'Project', to: 'Campaign' },
  HAS_PROCESS: { from: 'Project', to: 'Process' },
  PRIMARY_OWNER: { from: 'Process', to: 'Person' },
  BACKUP_OWNER: { from: 'Process', to: 'Person' },
  USES_GUIDE: { from: 'Process', to: 'KnowledgeNote' },
  FOLLOWS_DECISION: { from: 'Process', to: 'Decision' },
  ROSTER_SOURCE: { from: 'Process', to: 'KnowledgeNote' },
  LINKS_TO: { from: 'KnowledgeNote', to: 'KnowledgeNote' },
  CITES_SOURCE: { from: 'KnowledgeNote', to: 'Source' },
  CITES_DECISION: { from: 'KnowledgeNote', to: 'Decision' },
  ABOUT_PROJECT: { from: 'KnowledgeNote', to: 'Project' },
  HAS_INSTRUCTION: { from: 'Campaign', to: 'InstructionVersion' },
  FOR_CAMPAIGN: { from: 'Task', to: 'Campaign' },
  FOR_TASK: { from: 'Handoff', to: 'Task' },
  INCLUDES_INSTRUCTION: { from: 'Handoff', to: 'InstructionVersion' },
  RECORDED_EPISODE: { from: 'Campaign', to: 'ReviewEpisode' },
  REVIEWS_DRAFT: { from: 'ReviewEpisode', to: 'Draft' },
  SOURCE_NOTE: { from: 'ReviewEpisode', to: 'KnowledgeNote' },
};

function connectedGraphFixture(base: FixtureData, extra: ConnectedFixtureData, company: DemoCompany): FixtureData {
  const edges: FixtureEdge[] = [...base.edges];
  const add = (type: string, from: string, to: string) => edges.push({ type, from, to });
  add('HAS_PROJECT', extra.company.id, extra.project.id);
  add('RUNS_CAMPAIGN', extra.project.id, company.campaignId);
  for (const process of extra.processes) {
    add('HAS_PROCESS', extra.project.id, String(process.id));
    add('PRIMARY_OWNER', String(process.id), String(process.primaryId));
    if (process.backupId) add('BACKUP_OWNER', String(process.id), String(process.backupId));
    add('USES_GUIDE', String(process.id), String(process.guideId));
    add('FOLLOWS_DECISION', String(process.id), String(process.decisionId));
  }
  add('ROSTER_SOURCE', company.processId, company.noteIds.roster);
  for (const [from, to] of extra.noteLinks) add('LINKS_TO', from, to);
  for (const [from, to] of extra.sourceLinks) add('CITES_SOURCE', from, to);
  for (const note of extra.notes) add('ABOUT_PROJECT', String(note.id), extra.project.id);
  for (const id of [company.noteIds.decision, company.noteIds.guide, String(extra.processes[1]?.guideId)]) add('CITES_DECISION', id, extra.decision.id);
  for (const instruction of extra.instructions) add('HAS_INSTRUCTION', company.campaignId, String(instruction.id));
  add('FOR_CAMPAIGN', extra.task.id, company.campaignId);
  add('FOR_TASK', String(extra.handoff.id), extra.task.id);
  add('INCLUDES_INSTRUCTION', String(extra.handoff.id), company.oldToneId);
  add('INCLUDES_INSTRUCTION', String(extra.handoff.id), company.openingId);
  add('RECORDED_EPISODE', company.campaignId, extra.episode.id);
  add('REVIEWS_DRAFT', extra.episode.id, String(base.nodes.Draft?.[1]?.id));
  add('SOURCE_NOTE', extra.episode.id, company.noteIds.review);
  return {
    nodes: {
      ...base.nodes,
      Campaign: base.nodes.Campaign ?? [],
      Company: [extra.company], Person: extra.people, Project: [extra.project], Process: extra.processes,
      Decision: [extra.decision], KnowledgeNote: extra.notes, InstructionVersion: extra.instructions,
      Task: [extra.task], Handoff: [extra.handoff], ReviewEpisode: [extra.episode],
    },
    edges,
  };
}

function mergeFixtures(fixtures: FixtureData[]): FixtureData {
  const nodes: FixtureData['nodes'] = {};
  for (const fixture of fixtures) {
    for (const [label, records] of Object.entries(fixture.nodes)) nodes[label] = [...(nodes[label] ?? []), ...records];
  }
  return { nodes, edges: fixtures.flatMap((fixture) => fixture.edges) };
}

export async function seedFixture(graph: Graph, lease: FixtureSeedLease): Promise<void> {
  const fixture = mergeFixtures([
    connectedGraphFixture(
      JSON.parse(await readFile(fixturePath, 'utf8')) as FixtureData,
      JSON.parse(await readFile(connectedFixturePath, 'utf8')) as ConnectedFixtureData,
      demoCompanies[0],
    ),
    connectedGraphFixture(
      JSON.parse(await readFile(northstarFixturePath, 'utf8')) as FixtureData,
      JSON.parse(await readFile(northstarConnectedFixturePath, 'utf8')) as ConnectedFixtureData,
      demoCompanies[1],
    ),
  ]);
  const observedAt = new Date().toISOString();

  for (const company of demoCompanies) {
    await writeFixtureQuery(graph, lease,
      'MATCH (rollout:Rollout {id: $rolloutId}) SET rollout.current = false',
      { rolloutId: company.expandedRolloutId },
    );
  }

  for (const label of allowedLabels) {
    const records = (fixture.nodes[label] ?? []).map((record) => (
      Object.hasOwn(record, 'observedAt') ? { ...record, observedAt } : record
    ));
    if (!records.length) continue;
    const mutable = label === 'Process' || label === 'InstructionVersion';
    await writeFixtureQuery(graph, lease,
      `UNWIND $records AS record MERGE (node:${label} {id: record.id}) ${mutable ? 'ON CREATE SET' : 'SET'} node += record${label === 'Campaign' ? ' SET node.briefRevision = coalesce(node.briefRevision, 1)' : ''}`,
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
    `MATCH (feature:Feature {id: $featureId}), (other:Feature {id: $otherFeatureId})
SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1,
    other.factsRevision = coalesce(other.factsRevision, 0) + 1
MERGE (state:FixtureState {id: $id}) SET state.version = $version, state.completedAt = $completedAt`,
    { featureId: demoCompanies[0].featureId, otherFeatureId: demoCompanies[1].featureId,
      id: 'official-csv-launch', version: fixtureVersion, completedAt: new Date().toISOString() },
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

export async function expandDemoRollout(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = demoCompanyByCampaignId(campaignId);
  if (!company) throw new Error('Unknown demo company.');
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
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'rollout.expanded', occurredAt: $observedAt, title: 'Synthetic rollout expanded', detail: $eventDetail})
RETURN rollout.id AS rolloutId, event.id AS eventId`;

  const result = await graph.query(query, {
    params: {
      featureId: company.featureId,
      oldRolloutId: company.baselineRolloutId,
      allAccountsId: company.broadAudienceId,
      testersId: company.limitedAudienceId,
      rolloutId: company.expandedRolloutId,
      rolloutName: `All-audience rollout for ${company.shortName}`,
      environment: 'production',
      observedAt: new Date().toISOString(),
      sourceId: company.key === 'alder-finch' ? 'source-s4' : `source-expanded-${company.key}`,
      sourceLabel: 'Reviewed rollout expansion',
      sourceText: `${company.shortName} has enabled the feature for the broad audience, including the original pilot group.`,
      reviewedBy: 'Product teammate',
      eventId: randomUUID(),
      campaignId,
      eventDetail: `The local scenario now includes ${company.broadAudienceId === 'audience-all-accounts' ? 'all customer accounts' : 'all merchants'}.`,
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
        featureId: company.featureId,
        oldRolloutId: company.baselineRolloutId,
        rolloutId: company.expandedRolloutId,
        allAccountsId: company.broadAudienceId,
        testersId: company.limitedAudienceId,
        sourceId: company.key === 'alder-finch' ? 'source-s4' : `source-expanded-${company.key}`,
      },
    });
    if (!current.data?.length) throw new Error('The fictional rollout could not be updated in the graph.');
  }
}

export async function restoreDemoRollout(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = demoCompanyByCampaignId(campaignId);
  if (!company) throw new Error('Unknown demo company.');
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
       occurredAt: $observedAt, title: 'Synthetic rollout restored', detail: $eventDetail})
CREATE (feature)-[:HAS_EVENT]->(event)
RETURN baseline.id AS rolloutId, event.id AS eventId`;
  const transition = await graph.query<Record<string, unknown>>(query, {
    params: {
      featureId: company.featureId,
      expandedRolloutId: company.expandedRolloutId,
      baselineRolloutId: company.baselineRolloutId,
      observedAt,
      eventId: randomUUID(),
      campaignId,
      eventDetail: `The local scenario again limits ${company.shortName}'s feature to the reviewed group.`,
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
      featureId: company.featureId,
      expandedRolloutId: company.expandedRolloutId,
      baselineRolloutId: company.baselineRolloutId,
      testersId: company.limitedAudienceId,
      allAccountsId: company.broadAudienceId,
    },
  });
  if (!current.data?.length) throw new Error('The fictional rollout could not be restored in the graph.');
}

export async function setDemoTestAvailability(graph: Graph, available: boolean, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = demoCompanyByCampaignId(campaignId);
  if (!company) throw new Error('Unknown demo company.');
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
      featureId: company.featureId,
      testId: company.testId,
      available,
      observedAt,
      eventId: randomUUID(),
      campaignId,
      title: available ? 'Synthetic test restored' : 'Synthetic test result removed',
      detail: available
        ? `The local scenario restored the reviewed production test result for ${company.shortName}.`
        : 'The local scenario removed the current production test result to demonstrate an Unknown finding.',
    },
  });
  if (transition.data?.length) return;

  const current = await graph.query<unknown[]>(`
MATCH (:Feature {id: $featureId})-[:HAS_TEST]->(test:Test {id: $testId, current: $available})
RETURN test.id AS testId LIMIT 1`, {
    params: { featureId: company.featureId, testId: company.testId, available },
  });
  if (!current.data?.length) throw new Error('The fictional test scenario could not be updated in the graph.');
}
