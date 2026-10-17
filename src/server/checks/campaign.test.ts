import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import {
  assessDraftForAudience, CampaignChangedDuringCheckError, CampaignCheckCapacityError, CampaignLimitError, checkCampaign,
} from './campaign.js';
import { seedFixtureIfMissing } from '../graph/fixture.js';
import { canEnableDemoRollout, canInitializeFixture, canSeedFixture, canWriteDemo, isLoopbackHost, isSecureGraphEndpoint, localDemoConfigFromEnvironment } from '../config/guards.js';

type Row = unknown[];

const campaignRow = ['campaign-csv-launch', 'Spring reporting release', 'Alder & Finch Commerce', 'Multi-brand retail', 'North America', 'Product marketing', 'Spring 2026', 'All customer accounts', 'production'];
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
    Boolean(promiseId) && !wordingSource, Boolean(wordingSource), 0, 0, 0];
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
  driverObjectRows?: boolean;
  draftIdentityRows?: Row[];
  draftRows?: Row[];
  draftRowsAfterFirstRead?: Row[];
  deploymentRows?: Row[];
  rolloutRows?: Row[];
  testRows?: Row[];
}

function mockGraph(scenario: Scenario = {}): Graph {
  let draftReads = 0;
  function resultRows(query: string, rows: Row[]) {
    if (!scenario.driverObjectRows) return { data: rows };
    if (query.includes('count(DISTINCT draft) AS draftCount')) return { data: rows.map((row) => ({ draftId: row[0], draftCount: row[1] })) };
    const columns = query.includes('RETURN DISTINCT audience.id AS audienceId')
      ? ['audienceId', 'audienceName']
      : query.includes('<-[:IN_CAMPAIGN]-(draft:Draft)')
      ? ['draftId', 'draftTitle', 'draftKind', 'draftText', 'draftStatus', 'promiseId', 'promiseText', 'promiseReviewed',
        'featureId', 'featureName', 'audienceId', 'audienceName', 'reusedDraftId', 'reusedDraftTitle',
        'hasDirectPromise', 'hasReusedPromise', 'sortPosition', 'draftRevision', 'factRevision']
      : query.includes('MATCH (campaign:Campaign {id: $campaignId})\nRETURN')
        ? ['campaignId', 'campaignName', 'campaignCompanyName', 'campaignIndustry', 'campaignRegion', 'campaignOwnerTeam', 'campaignReleaseWindow', 'campaignAudience', 'campaignEnvironment']
        : query.includes('[:RUNNING_AS]')
          ? ['factId', 'revision', 'environment', 'includesFeature', 'reviewed', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy']
          : query.includes('[:HAS_ROLLOUT]')
            ? ['factId', 'factName', 'environment', 'reviewed', 'includedIds', 'excludedIds', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy']
            : ['factId', 'revision', 'environment', 'passed', 'reviewed', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy'];
    return { data: rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]]))) };
  }
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      if (query.includes('MATCH (campaign:Campaign {id: $campaignId})\nRETURN')) return resultRows(query, [campaignRow]);
      if (query.includes('RETURN DISTINCT audience.id AS audienceId')) {
        const audienceId = options?.params?.audienceId;
        const names: Record<string, string> = {
          'audience-all-accounts': 'All accounts',
          'audience-internal-testers': 'Internal testers',
        };
        return resultRows(query, typeof audienceId === 'string' && names[audienceId] ? [[audienceId, names[audienceId]]] : []);
      }
      if (query.includes('count(DISTINCT draft) AS draftCount')) {
        assert.match(query, /LIMIT 101/);
        const sourceRows = scenario.draftRows ?? baseDraftRows;
        const identities = scenario.draftIdentityRows
          ?? [...new Set(sourceRows.map((row) => row[0]))].map((id) => [id, 1]);
        return resultRows(query, identities);
      }
      if (query.includes('<-[:IN_CAMPAIGN]-(draft:Draft)')) {
        assert.match(query, /LIMIT 501/);
        assert.match(query, /\(reusedDraft:Draft\)-\[:IN_CAMPAIGN\]->\(campaign\)/, 'reused wording must stay within the requested campaign');
        assert.match(query, /OPTIONAL MATCH \(reusedDraft\)-\[:MAKES_PROMISE\]->\(reusedPromise:Promise\)/);
        assert.match(query, /WITH campaign, draft, directPromise, reusedPromise,[\s\S]*coalesce\(directPromise, reusedPromise\) AS promise/);
        assert.match(query, /RETURN DISTINCT[\s\S]*draft\.position AS sortPosition,[\s\S]*ORDER BY sortPosition/);
        const rows = draftReads++ > 0
          ? scenario.draftRowsAfterFirstRead ?? scenario.draftRows ?? baseDraftRows
          : scenario.draftRows ?? baseDraftRows;
        return resultRows(query, rows);
      }
      if (query.includes('[:RUNNING_AS]')) return resultRows(query, scenario.deploymentRows ?? deploymentRows);
      if (query.includes('[:HAS_ROLLOUT]')) {
        const requiredFactMatch = query.indexOf('MATCH (:Feature {id: $featureId})-[:HAS_ROLLOUT]');
        const optionalSourceMatch = query.indexOf('OPTIONAL MATCH (fact)-[:HAS_SOURCE]');
        const optionalMembershipMatch = query.indexOf('OPTIONAL MATCH (fact)-[:INCLUDES]');
        assert.ok(requiredFactMatch >= 0 && requiredFactMatch < optionalSourceMatch, 'current rollout match must precede optional source paths');
        assert.ok(optionalSourceMatch >= 0 && optionalSourceMatch < optionalMembershipMatch, 'source absence must not hide a current rollout');
        return resultRows(query, scenario.rolloutRows ?? [rolloutRow('rollout-testers-only', ['audience-internal-testers'], ['audience-all-accounts'])]);
      }
      if (query.includes('[:HAS_TEST]')) return resultRows(query, scenario.testRows ?? passingTestRows);
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

  assert.deepEqual(review.campaign, {
    id: 'campaign-csv-launch',
    name: 'Spring reporting release',
    companyName: 'Alder & Finch Commerce',
    industry: 'Multi-brand retail',
    region: 'North America',
    ownerTeam: 'Product marketing',
    releaseWindow: 'Spring 2026',
    audience: 'All customer accounts',
    environment: 'production',
  });
  assert.deepEqual(review.findings.map(({ draftId, status }) => [draftId, status]), [
    ['draft-landing', 'Contradicted'],
    ['draft-email', 'Contradicted'],
    ['draft-social', 'Supported'],
    ['draft-dashboard', 'Not checked'],
  ]);
  assert.equal(review.findings[1].promiseText, 'CSV export is available now to all accounts.');
  assert.equal(review.findings[1].wordingSourceTitle, 'Landing page');
  assert.equal(review.findings[3].reason, 'No reviewed product promise is linked to this draft.');
});

test('edit target audiences are checked against their own reviewed rollout evidence', async () => {
  const graph = mockGraph();
  const review = await checkCampaign(graph, 'campaign-csv-launch', checkedAt);
  const finding = review.findings.find((item) => item.draftId === 'draft-landing');
  assert.ok(finding);

  const internalTesters = await assessDraftForAudience(graph, review, finding, 'audience-internal-testers', checkedAt);
  const allAccounts = await assessDraftForAudience(graph, review, finding, 'audience-all-accounts', checkedAt);
  const unlinked = await assessDraftForAudience(graph, review, finding, 'audience-unlisted', checkedAt);

  assert.equal(internalTesters.status, 'Supported');
  assert.equal(allAccounts.status, 'Contradicted');
  assert.equal(unlinked.status, 'Unknown');
});

test('campaign checks normalize FalkorDB driver rows keyed by RETURN aliases', async () => {
  const review = await runCheck({ driverObjectRows: true });

  assert.deepEqual(review.findings.map(({ draftId, status }) => [draftId, status]), [
    ['draft-landing', 'Contradicted'],
    ['draft-email', 'Contradicted'],
    ['draft-social', 'Supported'],
    ['draft-dashboard', 'Not checked'],
  ]);
  assert.equal(review.findings[2].evidence[0].id, 'source-rollout-testers-only');
});

test('finding basis fingerprints change when linked facts change even if the status stays contradicted', async () => {
  const original = await runCheck();
  const changedRollout = rolloutRow('rollout-testers-only', ['audience-internal-testers'], ['audience-all-accounts']);
  changedRollout[8] = 'The current rollout excludes all accounts except internal testers.';
  const updated = await runCheck({ rolloutRows: [changedRollout] });
  const originalFinding = original.findings.find((finding) => finding.draftId === 'draft-landing');
  const updatedFinding = updated.findings.find((finding) => finding.draftId === 'draft-landing');
  assert.equal(originalFinding?.status, 'Contradicted');
  assert.equal(updatedFinding?.status, 'Contradicted');
  assert.notEqual(originalFinding?.basisFingerprint, updatedFinding?.basisFingerprint);
});

test('campaign checks fail closed when a draft ID is missing', async () => {
  await assert.rejects(runCheck({ draftIdentityRows: [['', 1]] }), /unique graph IDs/);
});

test('campaign checks fail closed when distinct drafts reuse a graph ID', async () => {
  await assert.rejects(runCheck({ draftIdentityRows: [['draft-landing', 2]] }), /unique graph IDs/);
});

test('campaign checks stop before fact fan-out when the campaign exceeds draft or promise-path bounds', async () => {
  const tooManyDrafts = Array.from({ length: 101 }, (_, index) => [`draft-${index}`, 1]);
  await assert.rejects(runCheck({ draftIdentityRows: tooManyDrafts }), CampaignLimitError);

  const tooManyPaths = Array.from({ length: 501 }, (_, index) => draftRow(`draft-${index % 100}`, 'Landing page', 'promise-1', 'A promise.', 'audience-all-accounts', 'All accounts'));
  await assert.rejects(runCheck({ draftRows: tooManyPaths }), CampaignLimitError);
});

test('campaign checks reject more than the configured number of distinct features', async () => {
  const identities = Array.from({ length: 26 }, (_, index) => [`draft-${index}`, 1]);
  const rows = identities.map(([id], index) => {
    const row = draftRow(String(id), 'Landing page', `promise-${index}`, 'A promise.', 'audience-all-accounts', 'All accounts');
    row[8] = `feature-${index}`;
    return row;
  });
  await assert.rejects(runCheck({ draftIdentityRows: identities, draftRows: rows }), CampaignLimitError);
});

test('campaign checks limit concurrent graph reads and release capacity after failure', async () => {
  let release!: () => void;
  let announceStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { announceStarted = resolve; });
  const graph = {
    async query(query: string) {
      if (query.includes('RETURN campaign.id AS campaignId')) {
        announceStarted();
        await gate;
      }
      return { data: [] };
    },
  } as unknown as Graph;

  const first = checkCampaign(graph, 'campaign-csv-launch', checkedAt);
  await started;
  const second = checkCampaign(graph, 'campaign-csv-launch', checkedAt);
  await assert.rejects(checkCampaign(graph, 'campaign-csv-launch', checkedAt), CampaignCheckCapacityError);
  release();
  await assert.rejects(first, /Campaign not found in FalkorDB/);
  await assert.rejects(second, /Campaign not found in FalkorDB/);
  await assert.rejects(checkCampaign(graph, 'campaign-csv-launch', checkedAt), /Campaign not found in FalkorDB/);
});

test('campaign checks fail closed when the draft revision changes during evidence reads', async () => {
  const changedRows = baseDraftRows.map((row) => [...row]);
  changedRows[0][17] = 1;
  await assert.rejects(runCheck({ draftRowsAfterFirstRead: changedRows }), CampaignChangedDuringCheckError);
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
  assert.match(review.findings[0].reason, /Additional gap: No current passing production test/);
  assert.equal(review.findings[2].status, 'Unknown');
});

test('current facts without an environment fail closed', async () => {
  const malformedRollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  malformedRollout[2] = '  ';
  const review = await runCheck({ rolloutRows: [malformedRollout] });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /no environment/);
  assert.deepEqual(review.findings[0].evidence.map(({ id }) => id), ['source-rollout-all-accounts']);
});

test('a known exclusion stays Contradicted when a supporting fact has no environment', async () => {
  const malformedTest = [...passingTestRows[0]];
  malformedTest[2] = '';
  const review = await runCheck({ testRows: [malformedTest] });

  assert.equal(review.findings[0].status, 'Contradicted');
  assert.match(review.findings[0].reason, /Additional gap: A current deployment or test has no environment/);
  assert.deepEqual(review.findings[0].evidence.map(({ id }) => id), ['source-rollout-testers-only']);
});

test('a blank deployment environment cannot be ignored when the audience is included', async () => {
  const malformedDeployment = [...deploymentRows[0]];
  malformedDeployment[2] = '';
  const review = await runCheck({
    deploymentRows: [malformedDeployment],
    rolloutRows: [rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], [])],
  });

  assert.equal(review.findings[0].status, 'Unknown');
  assert.match(review.findings[0].reason, /no environment/);
});

test('a finding only shows evidence from its environment and running revision', async () => {
  const allAccountsRollout = rolloutRow('rollout-all-accounts', ['audience-all-accounts', 'audience-internal-testers'], []);
  const review = await runCheck({
    rolloutRows: [
      allAccountsRollout,
      ['rollout-staging', 'Staging rollout', 'staging', true, ['audience-all-accounts', 'audience-internal-testers'], [],
        'source-staging-rollout', 'Staging rollout', 'Staging only.', '2026-10-15T00:10:00+05:30', 'Product teammate'],
    ],
    deploymentRows: [
      ...deploymentRows,
      ['deployment-staging', 'R90', 'staging', true, true, 'source-staging-deployment', 'Staging deployment', 'Staging only.',
        '2026-10-15T00:05:00+05:30', 'Product teammate'],
    ],
    testRows: [
      ...passingTestRows,
      ['test-old-revision', 'R16', 'production', true, true, 'source-old-revision-test', 'Old revision', 'Not the running revision.',
        '2026-10-15T00:15:00+05:30', 'Product teammate'],
      ['test-staging', 'R17', 'staging', true, true, 'source-staging-test', 'Staging test', 'Staging only.',
        '2026-10-15T00:15:00+05:30', 'Product teammate'],
    ],
  });

  assert.deepEqual(review.findings[2].evidence.map(({ id }) => id), [
    'source-rollout-all-accounts', 'source-s1', 'source-s3',
  ]);
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
  const fromEnvironment = localDemoConfigFromEnvironment({
    NODE_ENV: 'development',
    SEED_FIXTURE: 'true',
    ENABLE_DEMO_WRITES: 'true',
    FALKORDB_GRAPH: 'official',
    FALKORDB_HOST: '127.0.0.1',
    PORT: '3002',
  });
  assert.equal(canWriteDemo(fromEnvironment, { remoteAddress: '127.0.0.1', origin: 'http://127.0.0.1:3002' }), true);
  assert.equal(canWriteDemo({ ...fromEnvironment, seedFixture: undefined }, { remoteAddress: '127.0.0.1', origin: 'http://127.0.0.1:3002' }), false);
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
  const resetRolloutIds: string[] = [];
  let markerVersion = '';
  let markerWritten = false;
  let factsRevisionIncremented = false;
  let revisionAndMarkerAreAtomic = false;
  let seededFeatureRevision: unknown;
  const fencedSeedQueries: string[] = [];
  const beforeSeed = Date.now();
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
      if (query.startsWith('MATCH (lock:FixtureSeedLock') && query.includes('WITH lock')) fencedSeedQueries.push(query);
      if (query.includes('MATCH (state:FixtureState')) return { data: markerWritten ? [['official-csv-launch']] : [] };
      if (query.includes('MATCH (rollout:Rollout')) {
        resetRolloutIds.push(String(options?.params?.rolloutId ?? ''));
        return { data: [] };
      }
      if (query.includes('UNWIND $records AS record MERGE (node:Source')) {
        const records = options?.params?.records as Array<Record<string, unknown>>;
        sourceTimes.push(...records.map((record) => String(record.observedAt)));
      }
      if (query.includes('UNWIND $records AS record MERGE (node:Feature')) {
        const records = options?.params?.records as Array<Record<string, unknown>>;
        seededFeatureRevision = records.find((record) => record.id === 'feature-csv-export')?.factsRevision;
      }
      if (query.includes('SET feature.factsRevision = coalesce(feature.factsRevision, 0) + 1')) {
        factsRevisionIncremented = true;
        revisionAndMarkerAreAtomic = query.includes('MERGE (state:FixtureState');
      }
      if (query.includes('MERGE (state:FixtureState')) {
        markerVersion = String(options?.params?.version ?? '');
        markerWritten = true;
      }
      return { data: [] };
    },
  } as unknown as Graph;

  await seedFixtureIfMissing(graph);

  const afterSeed = Date.now();
  assert.deepEqual(resetRolloutIds, ['rollout-all-accounts', 'rollout-all-merchants']);
  assert.equal(markerVersion, 'connected-companies-v11');
  assert.equal(seededFeatureRevision, undefined);
  assert.equal(factsRevisionIncremented, true);
  assert.equal(revisionAndMarkerAreAtomic, true);
  assert.ok(fencedSeedQueries.length > 0);
  assert.ok(fencedSeedQueries.every((query) => query.includes('WHERE lock.leaseUntil > timestamp()')
    && query.includes('$seedLockFence')));
  assert.equal(sourceTimes.length, 6);
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
      if (query.includes('MERGE (lock:FixtureSeedLock')) return { data: [[1]] };
      if (query.includes('SET lock.leaseUntil = timestamp() + $ttlMs')) return { data: [[1]] };
      if (query.includes('SET lock.owner = null')) return { data: [] };
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
