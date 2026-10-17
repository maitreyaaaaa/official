import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Graph } from 'falkordb';
import type { CampaignReview, WorkspaceSnapshot } from '../../shared/contracts.js';
import { answerWorkspaceQuestion, resetWorkspaceDemo, reviewWriterDraft, WorkspaceError } from './workspace.js';

const snapshot = {
  company: { id: 'company-alder-finch', name: 'Alder & Finch Commerce', shortName: 'Alder & Finch', description: 'a fictional multi-brand retailer preparing its spring reporting release' },
  project: { name: 'Spring reporting release', summary: 'Release CSV export to a controlled audience and prepare accurate customer communications.' },
  notes: [
    { id: 'note-company', title: 'Company overview', summary: 'Team map', category: 'Company', sources: [] },
    { id: 'note-campaign-brief', title: 'Campaign brief', summary: 'Spring reporting launch goals', category: 'Campaigns', sources: [] },
    { id: 'note-release-decision', title: 'Dated rollout decision', summary: 'Tester-only on October 16', category: 'Decisions', sources: [{ id: 'source-s2' }] },
    { id: 'note-launch-checklist', title: 'Launch checklist', summary: 'Evidence review steps', category: 'Playbooks', sources: [{ id: 'source-s1' }] },
  ],
  memory: { briefRevision: 2, drafts: [{ status: 'pending_approval' }] },
  companyBrain: { processName: 'Launch evidence review', primaryName: 'Maya Chen', backupName: null,
    backupProposalStatus: 'pending', ownerUnavailable: true, coverage: 'Uncovered in this scenario',
    decisionTitle: 'Dated rollout decision', affectedProject: 'Spring reporting release' },
  events: [],
} as unknown as WorkspaceSnapshot;
const review = { findings: [
  { title: 'Landing page', status: 'Contradicted', draftState: 'active', needsReview: true },
  { title: 'Tester announcement', status: 'Supported', draftState: 'active', needsReview: false },
] } as CampaignReview;

test('company-note questions list the actually linked source records and date the decision', () => {
  const response = answerWorkspaceQuestion('Which company notes have sources?', snapshot, review);
  assert.match(response.answer, /2 have direct source or decision links/);
  assert.match(response.answer, /dated rollout decision is historical/);
  assert.deepEqual(response.sources.map((source) => source.id), ['note-company', 'note-release-decision', 'note-launch-checklist']);
});

test('workspace chat separates pending backup from real coverage', () => {
  const response = answerWorkspaceQuestion('Who covers launch evidence?', snapshot, review);
  assert.match(response.answer, /proposal is pending and does not count as coverage/);
  assert.match(response.answer, /Uncovered in this scenario/);
});

test('company questions use the selected company and project context', () => {
  const response = answerWorkspaceQuestion('Tell me about this company', snapshot, review);
  assert.match(response.answer, /Alder & Finch Commerce/);
  assert.match(response.answer, /Spring reporting release/);
  assert.deepEqual(response.sources.map((source) => source.id), ['note-company', 'note-campaign-brief', 'note-release-decision']);

  const northstar = {
    ...snapshot,
    company: { id: 'company-northstar-parcel', name: 'Northstar Parcel Logistics', shortName: 'Northstar Parcel', description: 'a fictional regional delivery operator' },
    project: { name: 'Delivery timeline release', summary: 'Give dispatch teams a current view of parcel delivery progress.' },
  } as unknown as WorkspaceSnapshot;
  const selected = answerWorkspaceQuestion('What is the current project?', northstar, review);
  assert.match(selected.answer, /Northstar Parcel Logistics/);
  assert.match(selected.answer, /Delivery timeline release/);
  assert.doesNotMatch(selected.answer, /Alder & Finch/);
});

test('draft approval checks both brief and evidence revisions before writing', async () => {
  let query = '';
  const graph = { query: async (text: string) => { query = text; return { data: [] }; } } as unknown as Graph;
  await assert.rejects(reviewWriterDraft(graph, '12345678-1234-1234-1234-123456789abc', 'approve'),
    (error: unknown) => error instanceof WorkspaceError && error.statusCode === 409);
  assert.match(query, /campaign\.briefRevision = draft\.briefRevision/);
  assert.match(query, /feature\.factsRevision = draft\.factRevision/);
  assert.match(query, /draft\.createdAt >= coalesce\(campaign\.demoResetAt, ''\)/);
});

test('fictional replay resets active memory and backup while recording an audit event', async () => {
  let query = '';
  let params: Record<string, unknown> = {};
  const graph = { query: async (text: string, options: { params: Record<string, unknown> }) => {
    query = text;
    params = options.params;
    return { data: [['campaign-csv-launch']] };
  } } as unknown as Graph;
  await resetWorkspaceDemo(graph);
  assert.match(query, /FOREACH \(link IN backupLinks \| DELETE link\)/);
  assert.match(query, /campaign\.demoResetAt = \$now/);
  assert.match(query, /kind: 'demo\.reset'/);
  assert.equal(params.campaignId, 'campaign-csv-launch');
});
