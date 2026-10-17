import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import type { CampaignReview } from '../../shared/contracts.js';
import { compareCampaignChecks, listCampaignActivity, recordCampaignCheck } from './activity.js';

const review: CampaignReview = {
  campaign: { id: 'campaign-csv-launch', name: 'Spring reporting release', companyName: 'Alder & Finch Commerce', industry: 'Multi-brand retail', region: 'North America', ownerTeam: 'Product marketing', releaseWindow: 'Spring 2026', audience: 'All customer accounts', environment: 'production' },
  checkedAt: '2026-10-15T12:00:00.000Z',
  findings: [
    { draftId: 'draft-landing', title: 'Landing page', kind: 'Landing page', text: 'Synthetic claim', promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Contradicted', reason: 'Excluded', evidence: [], needsReview: true },
    { draftId: 'draft-social', title: 'Social', kind: 'Social post', text: 'Synthetic claim', promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Supported', reason: 'Confirmed', evidence: [], needsReview: false },
    { draftId: 'draft-dashboard', title: 'Dashboard', kind: 'Email', text: 'Synthetic claim', promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Not checked', reason: 'No promise', evidence: [], needsReview: false },
  ],
  proactiveItems: [],
};

test('campaign check history stores status-only snapshots and a readable event in one query', async () => {
  let capturedQuery = '';
  let capturedParams: Record<string, unknown> = {};
  const graph = {
    async query(query: string, options: { params: Record<string, unknown> }) {
      capturedQuery = query;
      capturedParams = options.params;
      return { data: [{ eventId: options.params.eventId }] };
    },
  } as unknown as Graph;

  const entry = await recordCampaignCheck(graph, review);

  assert.match(capturedQuery, /CREATE \(run:ReviewRun/);
  assert.match(capturedQuery, /CREATE \(event:ActivityEvent/);
  assert.match(capturedQuery, /CREATE \(run\)-\[:GENERATED\]->\(event\)/);
  assert.deepEqual(JSON.parse(String(capturedParams.findingsJson)), [
    { draftId: 'draft-landing', status: 'Contradicted' },
    { draftId: 'draft-social', status: 'Supported' },
    { draftId: 'draft-dashboard', status: 'Not checked' },
  ]);
  assert.equal(String(capturedParams.findingsJson).includes('Synthetic claim'), false);
  assert.equal(entry.kind, 'campaign.checked');
  assert.match(entry.detail, /1 need review, 1 supported, 1 not checked/);
});

test('activity history normalizes FalkorDB alias-keyed rows and filters malformed entries', async () => {
  const graph = {
    async query() {
      return { data: [
        { id: 'event-2', campaignId: 'campaign-csv-launch', kind: 'demo.test_scenario.changed', occurredAt: '2026-10-15T12:02:00.000Z', title: 'Synthetic test result removed', detail: 'Current test unavailable.' },
        { id: 'event-1', campaignId: 'campaign-csv-launch', kind: 'rollout.expanded', occurredAt: '2026-10-15T12:01:00.000Z', title: 'Synthetic rollout expanded', detail: 'All accounts included.' },
        { id: '', campaignId: 'campaign-csv-launch', kind: 'campaign.checked', occurredAt: '2026-10-15T12:00:00.000Z', title: 'Broken', detail: '' },
        { id: 'event-other', campaignId: 'another-campaign', kind: 'campaign.checked', occurredAt: '2026-10-15T11:00:00.000Z', title: 'Other', detail: '' },
      ] };
    },
  } as unknown as Graph;

  assert.deepEqual(await listCampaignActivity(graph, 'campaign-csv-launch'), [
    { id: 'event-2', campaignId: 'campaign-csv-launch', kind: 'demo.test_scenario.changed', occurredAt: '2026-10-15T12:02:00.000Z', title: 'Synthetic test result removed', detail: 'Current test unavailable.' },
    { id: 'event-1', campaignId: 'campaign-csv-launch', kind: 'rollout.expanded', occurredAt: '2026-10-15T12:01:00.000Z', title: 'Synthetic rollout expanded', detail: 'All accounts included.' },
  ]);
});

test('saved campaign checks compare finding statuses without exposing draft copy', async () => {
  let capturedParams: Record<string, unknown> = {};
  const graph = {
    async query(_query: string, options: { params: Record<string, unknown> }) {
      capturedParams = options.params;
      return { data: [[
        'run-old', '2026-10-15T10:00:00.000Z', '[{"draftId":"draft-a","status":"Contradicted"}]',
        'run-new', '2026-10-15T10:30:00.000Z', '[{"draftId":"draft-a","status":"Supported"},{"draftId":"draft-b","status":"Unknown"}]',
      ]] };
    },
  } as unknown as Graph;

  const comparison = await compareCampaignChecks(graph, 'campaign-csv-launch', 'run-old', 'run-new');
  assert.deepEqual(capturedParams, { campaignId: 'campaign-csv-launch', leftRunId: 'run-old', rightRunId: 'run-new' });
  assert.deepEqual(comparison.changes, [
    { draftId: 'draft-a', leftStatus: 'Contradicted', rightStatus: 'Supported' },
    { draftId: 'draft-b', leftStatus: null, rightStatus: 'Unknown' },
  ]);
});
