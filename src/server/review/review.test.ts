import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import type { DraftFinding } from '../../shared/contracts.js';
import { checkCampaign } from '../checks/campaign.js';
import {
  approveCampaignProposal, listCampaignProposals, parseCreateProposalInput, previewCampaignAction, proposalMatchesFinding, proposeCampaignAction,
  requireSupportedTargetAudience, ReviewWorkflowError,
} from './review.js';

const finding: DraftFinding = {
  draftId: 'draft-landing', draftRevision: 2, factRevision: 3, basisFingerprint: 'basis-a',
  featureId: 'feature-csv-export', audienceId: 'audience-all-accounts', title: 'Landing page', kind: 'Landing page',
  text: 'CSV export is available to every account.', promiseText: 'CSV export is available now to all accounts.',
  wordingSourceTitle: null, featureName: 'CSV export', audienceName: 'All accounts', status: 'Contradicted',
  reason: 'The rollout excludes All accounts.', evidence: [], needsReview: true,
};

function workflowGraph(approvalResult: unknown[] = [['proposal-1']], draftState = 'draft') {
  const now = new Date();
  const observedAt = new Date(now.getTime() - 60_000).toISOString();
  const queries: string[] = [];
  let storedProposal: unknown[] | null = null;
  const graph = {
    async query(query: string, options?: { params?: Record<string, unknown> }) {
      queries.push(query);
      if (query.includes('MATCH (campaign:Campaign {id: $campaignId})\nRETURN')) {
        return { data: [['campaign-csv-launch', 'Spring reporting release', 'Alder & Finch Commerce', 'Multi-brand retail', 'North America', 'Product marketing', 'Spring 2026', 'All customer accounts', 'production']] };
      }
      if (query.includes('count(DISTINCT draft) AS draftCount')) return { data: [['draft-landing', 1]] };
      if (query.includes('<-[:IN_CAMPAIGN]-(draft:Draft)')) {
        const row: unknown[] = [
          'draft-landing', 'Landing page', 'Landing page', 'Available to every account.', 'draft',
          'promise-all-accounts', 'CSV export is available now to all accounts.', true,
          'feature-csv-export', 'CSV export', 'audience-all-accounts', 'All accounts', null, null,
          true, false, 0, 2, 3,
        ];
        row[4] = draftState;
        return { data: [row] };
      }
      if (query.includes('[:RUNNING_AS]')) return { data: [[
        'deployment-r17', 'R17', 'production', true, true, 'source-s1', 'Running version', 'Production runs R17.', observedAt, 'Product teammate',
      ]] };
      if (query.includes('[:HAS_ROLLOUT]')) return { data: [[
        'rollout-testers-only', 'Tester rollout', 'production', true,
        ['audience-internal-testers'], ['audience-all-accounts'], 'source-s2', 'Reviewed rollout', 'The rollout excludes all accounts.', observedAt, 'Product teammate',
      ]] };
      if (query.includes('[:HAS_TEST]')) return { data: [[
        'test-csv-r17', 'R17', 'production', true, true, 'source-s3', 'Functional test', 'CSV export passes.', observedAt, 'Product teammate',
      ]] };
      if (query.includes('RETURN DISTINCT audience.id AS audienceId')) {
        const audienceId = options?.params?.audienceId;
        const names: Record<string, string> = {
          'audience-all-accounts': 'All accounts',
          'audience-internal-testers': 'Internal testers',
        };
        return { data: typeof audienceId === 'string' && names[audienceId] ? [[audienceId, names[audienceId]]] : [] };
      }
      if (query.includes('RETURN proposal.id AS id, proposal.campaignId AS campaignId')) {
        return { data: storedProposal ? [storedProposal] : [] };
      }
      if (query.includes('CREATE (run:ReviewRun')) return { data: [['event-1']] };
      if (query.includes('CREATE (proposal:ActionProposal')) {
        assert.match(query, /OPTIONAL MATCH \(draft\)-\[:HAS_PROPOSAL\]->\(existing:ActionProposal \{status: 'pending'\}\)/);
        assert.match(query, /size\(existingProposals\) = 0/);
        assert.match(query, /coalesce\(draft\.status, 'draft'\) <> 'paused'/);
        return { data: [['proposal-1']] };
      }
      if (query.includes("SET proposal.status = 'needs_recheck'")) return { data: [['proposal-1']] };
      if (query.includes("SET draft.status = 'paused'")) return { data: approvalResult };
      if (query.includes('CREATE (promise:Promise {id: $promiseId')) return { data: approvalResult };
      return { data: [] };
    },
  };
  return {
    graph: graph as unknown as Graph,
    queries,
    now,
    setStoredProposal(row: unknown[]) { storedProposal = row; },
  };
}

test('proposal input only accepts bounded pause and edit actions', () => {
  assert.deepEqual(parseCreateProposalInput({ action: 'pause', reason: 'The rollout excludes the audience.' }), {
    action: 'pause', reason: 'The rollout excludes the audience.', proposedText: null, targetAudienceId: null,
  });
  assert.deepEqual(parseCreateProposalInput({ action: 'edit', proposedText: 'Available to internal testers.', targetAudienceId: 'audience-internal-testers', reason: 'Name the supported audience.' }), {
    action: 'edit', proposedText: 'Available to internal testers.', targetAudienceId: 'audience-internal-testers', reason: 'Name the supported audience.',
  });
  assert.throws(() => parseCreateProposalInput({ action: 'publish', reason: 'Send it.' }), ReviewWorkflowError);
  assert.throws(() => parseCreateProposalInput({ action: 'edit', proposedText: '', reason: 'Revise copy.' }), ReviewWorkflowError);
  assert.throws(() => parseCreateProposalInput({ action: 'edit', proposedText: 'Copy', targetAudienceId: 'other', reason: 'Revise copy.' }), ReviewWorkflowError);
  assert.throws(() => parseCreateProposalInput({ action: 'pause', reason: 'x'.repeat(501) }), ReviewWorkflowError);
});

test('proposal freshness compares draft revision, fact revision, and full basis fingerprint', () => {
  const proposal = {
    id: 'proposal-1', campaignId: 'campaign-csv-launch', draftId: finding.draftId, featureId: finding.featureId!,
    action: 'pause' as const, proposedText: null, reason: 'Pause until access is broad.', status: 'pending' as const,
    targetAudienceId: 'audience-all-accounts',
    createdAt: '2026-10-15T12:00:00Z', updatedAt: '2026-10-15T12:00:00Z', basedOnRunId: 'run-1',
    draftRevision: finding.draftRevision!, factRevision: finding.factRevision!, basisFingerprint: finding.basisFingerprint!, baselineText: finding.text,
  };
  assert.equal(proposalMatchesFinding(proposal, finding), true);
  assert.equal(proposalMatchesFinding(proposal, { ...finding, factRevision: 4 }), false);
  assert.equal(proposalMatchesFinding(proposal, { ...finding, basisFingerprint: 'basis-b' }), false);
  assert.equal(proposalMatchesFinding(proposal, { ...finding, status: 'Supported' }), false);
  assert.equal(proposalMatchesFinding(proposal, { ...finding, draftState: 'paused' }), false);
});

test('edit proposals require a target audience with a supported assessment', () => {
  assert.doesNotThrow(() => requireSupportedTargetAudience({
    audienceId: 'audience-internal-testers', audienceName: 'Internal testers', status: 'Supported',
    reason: 'Reviewed records confirm access.', evidence: [],
  }));
  for (const status of ['Contradicted', 'Unknown'] as const) {
    assert.throws(() => requireSupportedTargetAudience({
      audienceId: 'audience-all-accounts', audienceName: 'All accounts', status,
      reason: 'The current rollout does not support this audience.', evidence: [],
    }), (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409);
  }
});

test('proposal creation rejects an audience contradicted by current rollout evidence', async () => {
  const mock = workflowGraph();
  await assert.rejects(
    proposeCampaignAction(mock.graph, 'campaign-csv-launch', 'draft-landing', parseCreateProposalInput({
      action: 'edit', proposedText: 'Available to all accounts.', targetAudienceId: 'audience-all-accounts', reason: 'Keep the copy accurate.',
    }), mock.now),
    (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409,
  );
  assert.equal(mock.queries.some((query) => query.includes('CREATE (run:ReviewRun')), false);
  assert.equal(mock.queries.some((query) => query.includes('CREATE (proposal:ActionProposal')), false);
});

test('proposal preview checks current evidence without writing history or a pending proposal', async () => {
  const mock = workflowGraph();
  const preview = await previewCampaignAction(
    mock.graph,
    'campaign-csv-launch',
    'draft-landing',
    parseCreateProposalInput({ action: 'pause', reason: 'Wait for broad rollout evidence.' }),
    mock.now,
  );

  assert.deepEqual(preview, {
    action: 'pause',
    draftId: 'draft-landing',
    draftTitle: 'Landing page',
    proposedText: null,
    targetAudienceId: 'audience-all-accounts',
    reason: 'Wait for broad rollout evidence.',
  });
  assert.equal(mock.queries.some((query) => query.includes('CREATE (run:ReviewRun')), false);
  assert.equal(mock.queries.some((query) => query.includes('CREATE (proposal:ActionProposal')), false);
});

test('simultaneous proposals for one draft are serialized within the local app process', async () => {
  const mock = workflowGraph();
  const input = parseCreateProposalInput({ action: 'pause', reason: 'Pause until the rollout expands.' });
  const first = proposeCampaignAction(mock.graph, 'campaign-csv-launch', 'draft-landing', input, mock.now);
  await assert.rejects(
    proposeCampaignAction(mock.graph, 'campaign-csv-launch', 'draft-landing', input, mock.now),
    (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409,
  );
  await first;
});

test('paused drafts cannot receive duplicate pause or edit proposals', async () => {
  const mock = workflowGraph([['proposal-1']], 'paused');
  await assert.rejects(
    proposeCampaignAction(mock.graph, 'campaign-csv-launch', 'draft-landing', parseCreateProposalInput({
      action: 'pause', reason: 'Pause the contradictory copy.',
    }), mock.now),
    (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409,
  );
  assert.equal(mock.queries.some((query) => query.includes('CREATE (proposal:ActionProposal')), false);
});

test('proposal listing always returns pending items before the recent resolved history', async () => {
  const pending = ['pending-1', 'campaign-csv-launch', 'draft-landing', 'pause', null, 'Pause until the rollout expands.', 'audience-all-accounts', 'pending', '2026-10-14T10:00:00.000Z', '2026-10-14T10:00:00.000Z', 'run-1'];
  const resolved = ['resolved-1', 'campaign-csv-launch', 'draft-social', 'edit', 'Internal testers can use CSV export.', 'Applied after review.', 'audience-internal-testers', 'executed', '2026-10-15T10:00:00.000Z', '2026-10-15T10:00:00.000Z', 'run-2'];
  const queries: string[] = [];
  const graph = {
    async query(query: string) {
      queries.push(query);
      return query.includes("status: 'pending'") ? { data: [pending] } : { data: [resolved] };
    },
  } as unknown as Graph;

  const proposals = await listCampaignProposals(graph, 'campaign-csv-launch');
  assert.deepEqual(proposals.map((item) => [item.id, item.status]), [['pending-1', 'pending'], ['resolved-1', 'executed']]);
  assert.equal(queries.some((query) => query.includes('LIMIT 20')), true);
  assert.equal(queries.some((query) => query.includes("status: 'pending'") && query.includes('LIMIT')), false);
});

test('approval rechecks the proposed audience and moves an unsupported edit to needs_recheck', async () => {
  const mock = workflowGraph();
  const review = await checkCampaign(mock.graph, 'campaign-csv-launch', mock.now);
  const currentFinding = review.findings[0];
  mock.setStoredProposal([
    'proposal-1', 'campaign-csv-launch', currentFinding.draftId, currentFinding.featureId,
    'audience-all-accounts', 'edit', 'Available to all accounts.', 'Keep the copy accurate.', 'pending',
    mock.now.toISOString(), mock.now.toISOString(), 'run-1', currentFinding.draftRevision,
    currentFinding.factRevision, currentFinding.basisFingerprint, currentFinding.text,
  ]);

  await assert.rejects(
    approveCampaignProposal(mock.graph, 'campaign-csv-launch', 'proposal-1'),
    (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409,
  );
  assert.equal(mock.queries.some((query) => query.includes('CREATE (promise:Promise')), false);
  assert.equal(mock.queries.some((query) => query.includes("SET proposal.status = 'needs_recheck'")), true);
});

test('pause approval applies only while the checked revisions and baseline draft text still match', async () => {
  const mock = workflowGraph();
  const review = await checkCampaign(mock.graph, 'campaign-csv-launch', mock.now);
  const currentFinding = review.findings[0];
  mock.setStoredProposal([
    'proposal-1', 'campaign-csv-launch', currentFinding.draftId, currentFinding.featureId,
    'audience-all-accounts', 'pause', '', 'Pause until all accounts are supported.', 'pending',
    mock.now.toISOString(), mock.now.toISOString(), 'run-1', currentFinding.draftRevision,
    currentFinding.factRevision, currentFinding.basisFingerprint, currentFinding.text,
  ]);

  await approveCampaignProposal(mock.graph, 'campaign-csv-launch', 'proposal-1');

  const approvalQuery = mock.queries.find((query) => query.includes("SET draft.status = 'paused'"));
  assert.ok(approvalQuery);
  assert.match(approvalQuery, /MATCH \(draft:Draft\)\s+WHERE draft\.id = proposal\.draftId\s+MATCH \(draft\)-\[:IN_CAMPAIGN\]->\(campaign:Campaign\)\s+WHERE campaign\.id = \$campaignId/);
  assert.match(approvalQuery, /WITH proposal, draft, campaign\s+MATCH \(feature:Feature/);
  assert.doesNotMatch(approvalQuery, /MATCH \(draft:Draft \{id: proposal\.draftId\}\)-\[:IN_CAMPAIGN\]/);
  assert.match(approvalQuery, /coalesce\(draft\.officialRevision, 0\) = proposal\.draftRevision/);
  assert.match(approvalQuery, /coalesce\(feature\.factsRevision, 0\) = proposal\.factRevision/);
  assert.match(approvalQuery, /draft\.text = proposal\.baselineText/);
});

test('edit approval uses compatible FalkorDB draft matching and keeps all freshness guards', async () => {
  const mock = workflowGraph();
  const review = await checkCampaign(mock.graph, 'campaign-csv-launch', mock.now);
  const currentFinding = review.findings[0];
  mock.setStoredProposal([
    'proposal-1', 'campaign-csv-launch', currentFinding.draftId, currentFinding.featureId,
    'audience-internal-testers', 'edit', 'Available to internal testers.', 'Name the supported audience.', 'pending',
    mock.now.toISOString(), mock.now.toISOString(), 'run-1', currentFinding.draftRevision,
    currentFinding.factRevision, currentFinding.basisFingerprint, currentFinding.text,
  ]);

  await approveCampaignProposal(mock.graph, 'campaign-csv-launch', 'proposal-1');

  const approvalQuery = mock.queries.find((query) => query.includes('CREATE (promise:Promise {id: $promiseId'));
  assert.ok(approvalQuery);
  assert.match(approvalQuery, /MATCH \(draft:Draft\)\s+WHERE draft\.id = proposal\.draftId\s+MATCH \(draft\)-\[:IN_CAMPAIGN\]->\(campaign:Campaign\)\s+WHERE campaign\.id = \$campaignId/);
  assert.match(approvalQuery, /WITH proposal, draft, campaign\s+MATCH \(feature:Feature/);
  assert.doesNotMatch(approvalQuery, /MATCH \(draft:Draft \{id: proposal\.draftId\}\)-\[:IN_CAMPAIGN\]/);
  assert.match(approvalQuery, /coalesce\(draft\.officialRevision, 0\) = proposal\.draftRevision/);
  assert.match(approvalQuery, /coalesce\(feature\.factsRevision, 0\) = proposal\.factRevision/);
  assert.match(approvalQuery, /draft\.text = proposal\.baselineText/);
  assert.match(approvalQuery, /proposal\.action = 'edit'/);
});

test('a revision race during pause approval moves the proposal to needs_recheck', async () => {
  const mock = workflowGraph([]);
  const review = await checkCampaign(mock.graph, 'campaign-csv-launch', mock.now);
  const currentFinding = review.findings[0];
  mock.setStoredProposal([
    'proposal-1', 'campaign-csv-launch', currentFinding.draftId, currentFinding.featureId,
    'audience-all-accounts', 'pause', '', 'Pause until all accounts are supported.', 'pending',
    mock.now.toISOString(), mock.now.toISOString(), 'run-1', currentFinding.draftRevision,
    currentFinding.factRevision, currentFinding.basisFingerprint, currentFinding.text,
  ]);

  await assert.rejects(
    approveCampaignProposal(mock.graph, 'campaign-csv-launch', 'proposal-1'),
    (error: unknown) => error instanceof ReviewWorkflowError && error.statusCode === 409,
  );
  assert.equal(mock.queries.some((query) => query.includes("SET proposal.status = 'needs_recheck'")), true);
});
