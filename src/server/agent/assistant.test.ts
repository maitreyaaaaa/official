import assert from 'node:assert/strict';
import test from 'node:test';
import type { Graph } from 'falkordb';
import { AssistantUnavailableError, runCampaignAssistant } from './assistant.js';

const noToolAccess = { canSeedFixture: false, canPropose: false, proposalMode: 'preview' as const, persistChecks: false };

test('assistant stays optional when no API key is configured', async () => {
  await assert.rejects(
    runCampaignAssistant('Check the campaign.', {} as Graph, noToolAccess),
    AssistantUnavailableError,
  );
});

test('assistant uses the Responses API tool loop without exposing unavailable tools', async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const responses = [
    {
      id: 'resp_first',
      output: [{ type: 'function_call', call_id: 'call_1', name: 'delete_campaign', arguments: '{}' }],
    },
    { id: 'resp_second', output: [], output_text: 'That action is not available.' },
  ];
  const fetcher: typeof fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    assert.ok(next);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  let graphQueries = 0;
  const graph = {
    query: async () => {
      graphQueries += 1;
      throw new Error('Unknown tools must not query the graph.');
    },
  } as unknown as Graph;

  const result = await runCampaignAssistant('Delete the campaign.', graph, noToolAccess, {
    apiKey: 'test-only',
    fetcher,
  });

  assert.equal(result.answer, 'That action is not available.');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.summary, 'That tool is not available.');
  assert.equal(graphQueries, 0);
  assert.equal(requestBodies.length, 2);
  const firstTools = requestBodies[0]?.tools as Array<{ name?: string }>;
  assert.ok(firstTools.some((tool) => tool.name === 'check_campaign'));
  assert.ok(!firstTools.some((tool) => tool.name === 'propose_draft_action'));
  assert.equal(requestBodies[0]?.parallel_tool_calls, false);
  assert.equal(requestBodies[1]?.previous_response_id, 'resp_first');
});

test('assistant advertises proposal previews only when the caller explicitly enables them', async () => {
  const toolLists: Array<Array<{ name?: string }>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string }> };
    toolLists.push(request.tools);
    return new Response(JSON.stringify({ id: 'resp_answer', output: [], output_text: 'I can explain the evidence.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await runCampaignAssistant('Explain the finding.', {} as Graph, noToolAccess, { apiKey: 'test-only', fetcher });
  await runCampaignAssistant('Explain the finding.', {} as Graph, { ...noToolAccess, canPropose: true }, { apiKey: 'test-only', fetcher });

  assert.equal(toolLists[0]?.some((tool) => tool.name === 'propose_draft_action'), false);
  assert.equal(toolLists[1]?.some((tool) => tool.name === 'propose_draft_action'), true);
});

test('assistant returns the final answer after completing the fourth tool call', async () => {
  const responses = [
    { id: 'resp_1', output: [{ type: 'function_call', call_id: 'call_1', name: 'unknown_1', arguments: '{}' }] },
    { id: 'resp_2', output: [{ type: 'function_call', call_id: 'call_2', name: 'unknown_2', arguments: '{}' }] },
    { id: 'resp_3', output: [{ type: 'function_call', call_id: 'call_3', name: 'unknown_3', arguments: '{}' }] },
    { id: 'resp_4', output: [{ type: 'function_call', call_id: 'call_4', name: 'unknown_4', arguments: '{}' }] },
    { id: 'resp_final', output: [], output_text: 'Here is the result after four tool calls.' },
  ];
  const fetcher: typeof fetch = async () => {
    const next = responses.shift();
    assert.ok(next);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await runCampaignAssistant('Check several things.', {} as Graph, noToolAccess, {
    apiKey: 'test-only',
    fetcher,
  });

  assert.equal(result.answer, 'Here is the result after four tool calls.');
  assert.equal(result.toolCalls.length, 4);
});

test('assistant proposal tool returns an unsaved preview and makes no proposal or history writes', async () => {
  const draftRow = [
    'draft-landing', 'Landing page', 'Landing page', 'CSV export is available to every account.', 'draft',
    'promise-all-accounts', 'CSV export is available now to all accounts.', true,
    'feature-csv-export', 'CSV export', 'audience-all-accounts', 'All accounts', null, null, true, false, 0, 2, 3,
  ];
  const graphQueries: string[] = [];
  const graph = {
    async query(query: string) {
      graphQueries.push(query);
      if (query.includes('MATCH (state:FixtureState')) return { data: [['official-csv-launch']] };
      if (query.includes('MATCH (campaign:Campaign {id: $campaignId})\nRETURN')) {
        return { data: [['campaign-csv-launch', 'Spring reporting release', 'Alder & Finch Commerce', 'Multi-brand retail', 'North America', 'Product marketing', 'Spring 2026', 'All customer accounts', 'production']] };
      }
      if (query.includes('count(DISTINCT draft) AS draftCount')) return { data: [['draft-landing', 1]] };
      if (query.includes('<-[:IN_CAMPAIGN]-(draft:Draft)')) return { data: [draftRow] };
      if (query.includes('[:RUNNING_AS]')) return { data: [[
        'deployment-r17', 'R17', 'production', true, true,
        'source-s1', 'S1 · Running version', 'Production runs R17 with CSV export.',
        '2026-10-15T00:05:00+05:30', 'Product teammate',
      ]] };
      if (query.includes('[:HAS_ROLLOUT]')) return { data: [[
        'rollout-testers-only', 'Tester rollout', 'production', true,
        ['audience-internal-testers'], ['audience-all-accounts'], 'source-s2', 'S2 · Rollout',
        'The rollout excludes all other accounts.', '2026-10-15T00:10:00+05:30', 'Product teammate',
      ]] };
      if (query.includes('[:HAS_TEST]')) return { data: [[
        'test-csv-r17', 'R17', 'production', true, true,
        'source-s3', 'S3 · Test', 'The CSV export smoke test passed on R17.',
        '2026-10-15T00:15:00+05:30', 'Product teammate',
      ]] };
      throw new Error(`Unexpected query in assistant preview test: ${query}`);
    },
  } as unknown as Graph;
  const responses = [
    {
      id: 'resp_proposal',
      output: [{
        type: 'function_call', call_id: 'call_proposal', name: 'propose_draft_action',
        arguments: JSON.stringify({
          action: 'pause', draftId: 'draft-landing', reason: 'Wait for a broad rollout.',
          proposedText: null, targetAudienceId: null,
        }),
      }],
    },
    { id: 'resp_summary', output: [], output_text: 'I prepared a pause preview for review.' },
  ];
  const fetcher: typeof fetch = async () => {
    const next = responses.shift();
    assert.ok(next);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await runCampaignAssistant('Propose pausing the landing page.', graph, {
    canSeedFixture: false,
    canPropose: true,
    proposalMode: 'preview',
    persistChecks: true,
  }, { apiKey: 'test-only', model: 'test-model', fetcher });

  assert.deepEqual(result.proposalPreview, {
    action: 'pause',
    draftId: 'draft-landing',
    draftTitle: 'Landing page',
    proposedText: null,
    targetAudienceId: 'audience-all-accounts',
    reason: 'Wait for a broad rollout.',
  });
  assert.equal(result.toolCalls[0]?.summary, 'Prepared an unsaved proposal preview for the user to review.');
  assert.equal(graphQueries.some((query) => query.includes('CREATE (run:ReviewRun')), false);
  assert.equal(graphQueries.some((query) => query.includes('CREATE (proposal:ActionProposal')), false);
  assert.equal(graphQueries.some((query) => query.includes("kind: 'proposal.created'")), false);
});
