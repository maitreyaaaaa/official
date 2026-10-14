import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import { checkCampaign } from './campaign.js';
import { seedFixtureIfMissing } from '../graph/fixture.js';
import { canEnableDemoRollout, canInitializeFixture, canSeedFixture, canWriteDemo, isLoopbackHost, isSecureGraphEndpoint } from '../config/guards.js';

type Row = unknown[];

const campaignRow = ['campaign-csv-launch', 'CSV export launch', 'All customer accounts', 'production'];
const checkedAt = new Date('2026-10-15T12:00:00.000Z');
const deploymentRows: Row[] = [[
  'deployment-r17', 'R17', 'production', true, true,
  'source-s1', 'S1 · Running version', 'Production is running R17 with CSV export.',
  '2026-10-15T00:05:00+05:30', 'Product teammate',
]];
const passingTestRows: Row[] = [[
  'test-csv-r17', 'R17', 'production', true, true,
  'source-s3', 'S3 · Functional test', 'The CSV export smoke test passed on R17.',
  '2026-10-15T00:15:00+05:30', 'Product teammate',
]];

function draftRow(id: string, title: string, promiseId: string, promiseText: string, audienceId: string, audienceName: string, wordingSource?: { id: string; title: string }): Row {
  return [id, title, 'Email', `${title} draft text.`, 'draft', promiseId, promiseText, true,
    'feature-csv-export', 'CSV export', audienceId, audienceName, wordingSource?.id ?? null, wordingSource?.title ?? null,
    Boolean(promiseId) && !wordingSource, Boolean(wordingSource)];
}

const baseDraftRows: Row[] = [
  draftRow('draft-landing', 'Landing page', 'promise-all-accounts', 'CSV export is available now to all accounts.', 'audience-all-accounts', 'All accounts'),
  draftRow('draft-email', 'Launch email', 'promise-all-accounts', 'CSV export is available now to all accounts.', 'audience-all-accounts', 'All accounts', { id: 'draft-landing', title: 'Landing page' }),
  draftRow('draft-social', 'Tester announcement', 'promise-testers', 'CSV export is available now to internal testers.', 'audience-internal-testers', 'Internal testers'),
  ['draft-dashboard', 'Dashboard update', 'Email', 'See your work in one dashboard.', 'draft', null, null, null, null, null, null, null, null, null],
];

function rolloutRow(
  id: string,
  includedIds: string[],
  excludedIds: string[],
  reviewed = true,
): Row {
  return [id, id, 'production', reviewed, includedIds, excludedIds,
    `source-${id}`, id, `Source for ${id}.`, '2026-10-15T00:10:00+05:30', 'Product teammate'];
}

function withoutSource(row: Row, sourceOffset: number): Row {
  const copy = [...row];
  copy.splice(sourceOffset, 5, null, null, null, null, null);
  return copy;
}

interface Scenario {
  draftRows?: Row[];
  deploymentRows?: Row[];
  rolloutRows?: Row[];
  testRows?: Row[];
}

function mockGraph(scenario: Scenario = {}): Graph {
  const graph = {
    async query(query: string) {
      if (query.includes('MATCH (campaign:Campaign {id: $campaignId})\nRETURN')) return { data: [campaignRow] };
      if (query.includes('<-[:IN_CAMPAIGN]-(draft:Draft)')) return { data: scenario.draftRows ?? baseDraftRows };
      if (query.includes('[:RUNNING_AS]')) return { data: scenario.deploymentRows ?? deploymentRows };
      if (query.includes('[:HAS_ROLLOUT]')) {
        const requiredFactMatch = query.indexOf('MATCH (:Feature {id: $featureId})-[:HAS_ROLLOUT]');
        const optionalSourceMatch = query.indexOf('OPTIONAL MATCH (fact)-[:HAS_SOURCE]');
        const optionalMembershipMatch = query.indexOf('OPTIONAL MATCH (fact)-[:INCLUDES]');
        assert.ok(requiredFactMatch >= 0 && requiredFactMatch < optionalSourceMatch, 'current rollout match must precede optional source paths');
        assert.ok(optionalSourceMatch >= 0 && optionalSourceMatch < optionalMembershipMatch, 'source absence must not hide a current rollout');
        return { data: scenario.rolloutRows ?? [rolloutRow('rollout-testers-only', ['audience-internal-testers'], ['audience-all-accounts'])] };
      }
      if (query.includes('[:HAS_TEST]')) return { data: scenario.testRows ?? passingTestRows };
      throw new Error(`Unexpected query in test double: ${query}`);
    },
  };
  return graph as unknown as Graph;
}

function runCheck(scenario: Scenario = {}) {
  return checkCampaign(mockGraph(scenario), 'campaign-csv-launch', checkedAt);
}

test('initial campaign findings match the canonical scenario, including D2 promise reuse', async () => {
  const review = await runCheck();

  assert.deepEqual(review.findings.map(({ draftId, status }) => [draftId, status]), [
    ['draft-landing', 'Contradicted'],
    ['draft-email', 'Contradicted'],
    ['draft-social', 'Supported'],
    ['draft-dashboard', 'Not checked'],
  ]);
  assert.equal(review.findings[1].promiseText, 'CSV export is available now to all accounts.');
  assert.equal(review.findings[1].wordingSourceTitle, 'Landing page');
});

test('S4 supports all-account promises while the tester promise stays supported', async () => {
  const review = await runCheck({
    rolloutRows: [rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], [])],
  });

  assert.deepEqual(review.findings.map(({ draftId, status }) => [draftId, status]), [
    ['draft-landing', 'Supported'],
    ['draft-email', 'Supported'],
    ['draft-social', 'Supported'],
    ['draft-dashboard', 'Not checked'],
  ]);
});

test('a rollout that includes and excludes the same audience is Unknown', async () => {
  const review = await runCheck({
    rolloutRows: [rolloutRow('rollout-conflict', ['audience-all-accounts'], ['audience-all-accounts'])],
  });

  assert.equal(review.findings[0].status, 'Unknown');
});

test('conflicting current rollout records are Unknown', async () => {
  const review = await runCheck({
    rolloutRows: [
      rolloutRow('rollout-testers-only', ['audience-internal-testers'], ['audience-all-accounts']),
      rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []),
    ],
  });

  assert.equal(review.findings[0].status, 'Unknown');
});

test('a known exclusion remains Contradicted when the functional test is missing', async () => {
  const review = await runCheck({ testRows: [] });

  assert.equal(review.findings[0].status, 'Contradicted');
  assert.equal(review.findings[2].status, 'Unknown');
});

test('unreviewed rollout evidence cannot support a promise', async () => {
  const review = await runCheck({
    rolloutRows: [rolloutRow('rollout-unreviewed', ['audience-all-accounts'], [], false)],
  });

  assert.equal(review.findings[0].status, 'Unknown');
});

test('multiple promise paths for one draft are reported as Unknown', async () => {
  const review = await runCheck({ draftRows: [baseDraftRows[0], baseDraftRows[0], ...baseDraftRows.slice(1)] });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /More than one promise or audience path/);
  assert.equal(review.findings.length, 4);
});

test('a linked promise with a missing ID or claim text is Unknown', async () => {
  const missingId = [...baseDraftRows[0]];
  missingId[5] = '';
  missingId[14] = true;
  const missingText = [...baseDraftRows[0]];
  missingText[6] = '   ';
  const [missingIdReview, missingTextReview] = await Promise.all([
    runCheck({ draftRows: [missingId, ...baseDraftRows.slice(1)] }),
    runCheck({ draftRows: [missingText, ...baseDraftRows.slice(1)] }),
  ]);

  assert.equal(missingIdReview.findings[0].status, 'Unknown');
  assert.match(missingIdReview.findings[0].reason, /missing its stable ID or claim text/);
  assert.equal(missingTextReview.findings[0].status, 'Unknown');
  assert.match(missingTextReview.findings[0].reason, /missing its stable ID or claim text/);
});

test('duplicate current fact IDs with conflicting data are Unknown', async () => {
  const review = await runCheck({
    rolloutRows: [
      rolloutRow('rollout-duplicate', ['audience-all-accounts', 'audience-internal-testers'], []),
      rolloutRow('rollout-duplicate', ['audience-internal-testers'], ['audience-all-accounts']),
    ],
  });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /same ID disagree/);
});

test('a draft with both direct and reused promises is reported as Unknown', async () => {
  const ambiguous = [...baseDraftRows[1].slice(0, 14), true, true];
  const review = await runCheck({ draftRows: [baseDraftRows[0], ambiguous, ...baseDraftRows.slice(2)] });

  assert.equal(review.findings[1].status, 'Unknown');
  assert.match(review.findings[1].reason, /both a direct promise and a reused promise/);
});

test('fixture and demo writes require a local development graph', () => {
  const local = { nodeEnv: 'development', seedFixture: 'true', enableDemoWrites: 'true', graph: 'official', falkordbHost: 'localhost', port: 3001 };
  assert.equal(canSeedFixture(local), true);
  assert.equal(canEnableDemoRollout(local), true);
  assert.equal(canInitializeFixture(local, { remoteAddress: '127.0.0.1', origin: 'http://127.0.0.1:3001' }), true);
  assert.equal(canInitializeFixture(local, { remoteAddress: '127.0.0.1', origin: 'https://attacker.example' }), false);
  assert.equal(canInitializeFixture(local, { remoteAddress: '127.0.0.1' }), false);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isSecureGraphEndpoint('falkordb.example.com', false), false);
  assert.equal(isSecureGraphEndpoint('falkordb.example.com', true), true);
  assert.equal(isSecureGraphEndpoint('localhost', false), true);
  assert.equal(canSeedFixture({ ...local, falkordbHost: 'falkordb.example.com' }), false);
  assert.equal(canSeedFixture({ ...local, nodeEnv: undefined }), false);
  assert.equal(canWriteDemo(local, { remoteAddress: '127.0.0.1', origin: 'http://127.0.0.1:3001' }), true);
  assert.equal(canWriteDemo({ ...local, falkordbHost: 'falkordb.example.com' }, { remoteAddress: '127.0.0.1', origin: 'http://127.0.0.1:3001' }), false);
  assert.equal(canEnableDemoRollout({ ...local, enableDemoWrites: 'false' }), false);
  assert.equal(canWriteDemo(local, { remoteAddress: '127.0.0.1', origin: 'https://attacker.example' }), false);
  assert.equal(canWriteDemo(local, { remoteAddress: '127.0.0.1' }), false);
  assert.equal(canWriteDemo(local, { remoteAddress: '10.0.0.2', origin: 'http://127.0.0.1:3001' }), false);
});

test('source-less current rollout cannot support or contradict a promise', async () => {
  const allAccounts = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  const review = await runCheck({ rolloutRows: [withoutSource(allAccounts, 6)] });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /missing a fresh source/);
});

test('current deployments that disagree about feature presence are Unknown', async () => {
  const review = await runCheck({
    rolloutRows: [rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], [])],
    deploymentRows: [
      deploymentRows[0],
      ['deployment-r18', 'R18', 'production', false, true, 'source-r18', 'S4 · Running version', 'Current deployment says CSV export is absent.', '2026-10-15T00:05:00+05:30', 'Product teammate'],
    ],
  });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /deployment records disagree/);
});

test('stale current rollout sources cannot support a promise', async () => {
  const staleRollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  staleRollout[9] = '2026-08-01T00:00:00.000Z';
  const review = await runCheck({ rolloutRows: [staleRollout] });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /missing a fresh source/);
});

test('stale deployment and test sources cannot support a promise', async () => {
  const rollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  const staleDeployment = [...deploymentRows[0]];
  staleDeployment[8] = '2026-08-01T00:00:00.000Z';
  const staleTest = [...passingTestRows[0]];
  staleTest[8] = '2026-08-01T00:00:00.000Z';
  const deploymentReview = await runCheck({ deploymentRows: [staleDeployment], rolloutRows: [rollout] });
  const testReview = await runCheck({ testRows: [staleTest], rolloutRows: [rollout] });

  assert.equal(deploymentReview.findings[0].status, 'Unknown');
  assert.equal(testReview.findings[0].status, 'Unknown');
});

test('source timestamps too far in the future cannot support a promise', async () => {
  const futureRollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  futureRollout[9] = '2026-10-15T12:06:00.000Z';
  const review = await runCheck({ rolloutRows: [futureRollout] });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /missing a fresh source/);
});

test('source-less deployment and test records remain Unknown', async () => {
  const rollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  const deploymentReview = await runCheck({ deploymentRows: [withoutSource(deploymentRows[0], 5)], rolloutRows: [rollout] });
  const testReview = await runCheck({ testRows: [withoutSource(passingTestRows[0], 5)], rolloutRows: [rollout] });

  assert.equal(deploymentReview.findings[0].status, 'Unknown');
  assert.equal(testReview.findings[0].status, 'Unknown');
});

test('blank source IDs and source content cannot support a promise', async () => {
  const rollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  const blankId = [...rollout];
  blankId[6] = '   ';
  const blankDetail = [...rollout];
  blankDetail[8] = '   ';
  const blankIdReview = await runCheck({ rolloutRows: [blankId] });
  const blankDetailReview = await runCheck({ rolloutRows: [blankDetail] });

  assert.equal(blankIdReview.findings[0].status, 'Unknown');
  assert.equal(blankDetailReview.findings[0].status, 'Unknown');
  assert.match(blankDetailReview.findings[0].reason, /missing a fresh source/);
});

test('fixture seed refreshes source timestamps and clears the prior S4 rollout', async () => {
  const sourceTimes: string[] = [];
  let resetRolloutId = '';
  let markerVersion = '';
  const beforeSeed = Date.now();
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      if (query.includes('MATCH (state:FixtureState')) return { data: [] };
      if (query.includes('MATCH (rollout:Rollout')) {
        resetRolloutId = String(options?.params?.rolloutId ?? '');
        return { data: [] };
      }
      if (query.includes('UNWIND $records AS record MERGE (node:Source')) {
        const records = options?.params?.records as Array<Record<string, unknown>>;
        sourceTimes.push(...records.map((record) => String(record.observedAt)));
      }
      if (query.includes('MERGE (state:FixtureState')) {
        markerVersion = String(options?.params?.version ?? '');
      }
      return { data: [] };
    },
  } as unknown as Graph;

  await seedFixtureIfMissing(graph);

  const afterSeed = Date.now();
  assert.equal(resetRolloutId, 'rollout-all-accounts');
  assert.equal(markerVersion, 'csv-launch-v2');
  assert.equal(sourceTimes.length, 3);
  assert.ok(sourceTimes.every((value) => {
    const timestamp = Date.parse(value);
    return timestamp >= beforeSeed && timestamp <= afterSeed;
  }));
});

test('a partial fixture seed is retried because completion is marked last', async () => {
  let markerWritten = false;
  let failed = false;
  let writes = 0;
  const graph = {
    async query(query: string) {
      if (query.includes('MATCH (state:FixtureState')) return { data: markerWritten ? [['official-csv-launch']] : [] };
      writes += 1;
      if (!failed && writes === 3) {
        failed = true;
        throw new Error('simulated seed interruption');
      }
      if (query.includes('MERGE (state:FixtureState')) markerWritten = true;
      return { data: [] };
    },
  } as unknown as Graph;

  await assert.rejects(seedFixtureIfMissing(graph), /simulated seed interruption/);
  assert.equal(markerWritten, false);
  await seedFixtureIfMissing(graph);
  assert.equal(markerWritten, true);
});
