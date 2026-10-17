import 'dotenv/config';
import express from 'express';
import type { Graph } from 'falkordb';
import {
  CampaignChangedDuringCheckError, CampaignCheckCapacityError, CampaignDataIntegrityError,
  CampaignLimitError, checkCampaign,
} from './checks/campaign.js';
import { listCampaignActivity, recordCampaignCheck } from './activity/activity.js';
import {
  approveCampaignProposal, listCampaignProposals, parseCreateProposalInput, proposeCampaignAction,
  rejectCampaignProposal, resumeCampaignDraft, ReviewWorkflowError,
} from './review/review.js';
import { getGraph } from './graph/client.js';
import { expandDemoRollout, isFixtureReady, restoreDemoRollout, seedFixtureIfMissing, setDemoTestAvailability } from './graph/fixture.js';
import { canInitializeFixture, canSeedFixture, canServeDemoApp, canWriteDemo, localDemoConfigFromEnvironment } from './config/guards.js';
import { ApiRequestLimiter } from './config/api-rate-limit.js';
import { AssistantServiceError, AssistantUnavailableError, runCampaignAssistant } from './agent/assistant.js';
import type { CampaignAssistantResponse } from '../shared/contracts.js';
import { answerWorkspaceQuestion, approveBackup, approveTone, loadWorkspace, proposeBackup, resetWorkspaceDemo, reviewWriterDraft, runWriterSession, WorkspaceError } from './workspace/workspace.js';

export const app = express();
app.use((request, response, next) => {
  if (!canServeDemoApp(localDemoConfigFromEnvironment(process.env), {
    remoteAddress: request.socket.remoteAddress,
    host: request.get('host'),
  })) {
    response.status(403).json({ error: 'The reviewer demo is not enabled for this deployment.' });
    return;
  }
  next();
});
const apiRequestLimiter = new ApiRequestLimiter();
app.use('/api', (request, response, next) => {
  const decision = apiRequestLimiter.consume(request.socket.remoteAddress ?? 'unknown');
  if (!decision.allowed) {
    response.set('Retry-After', String(decision.retryAfterSeconds))
      .status(429)
      .json({ error: 'Too many local API requests. Wait before trying again.' });
    return;
  }
  next();
});
app.use(express.raw({
  limit: '8kb',
  type: (request) => request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json',
}));
app.use((request, response, next) => {
  if (Buffer.isBuffer(request.body) && request.body.byteLength > 0) {
    response.status(415).json({ error: 'Request content type or encoding is unsupported.' });
    return;
  }
  next();
});
app.use(express.json({ limit: '8kb' }));
let activeAssistantRequests = 0;
const maxActiveAssistantRequests = 2;

// Route tests replace this provider so guard checks cannot touch configured graph data.
app.locals.graphProvider = getGraph;

async function requestGraph(): Promise<Graph> {
  const provider = app.locals.graphProvider as (() => Promise<Graph>) | undefined;
  if (!provider) throw new Error('The local graph client is not configured.');
  return await provider();
}

function fixtureInitializationAllowed(request: express.Request): boolean {
  return canInitializeFixture(localDemoConfigFromEnvironment(process.env), {
    remoteAddress: request.socket.remoteAddress,
    origin: request.get('origin'),
    host: request.get('host'),
  });
}

function demoWritesEnabled(request: express.Request): boolean {
  return canWriteDemo(localDemoConfigFromEnvironment(process.env), {
    remoteAddress: request.socket.remoteAddress,
    origin: request.get('origin'),
    host: request.get('host'),
  });
}

app.get('/api/capabilities', (request, response) => {
  const config = localDemoConfigFromEnvironment(process.env);
  const origin = request.get('origin') ?? (() => {
    try {
      return new URL(request.get('referer') ?? '').origin;
    } catch {
      return undefined;
    }
  })();
  const writesAvailable = canWriteDemo(config, {
    remoteAddress: request.socket.remoteAddress,
    origin,
    host: request.get('host'),
  });
  response.set('Cache-Control', 'no-store').json({
    demoRollout: writesAvailable,
    assistant: Boolean(process.env.OPENAI_API_KEY?.trim()) && writesAvailable,
  });
});

app.post('/api/assistant', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (!demoWritesEnabled(request)) {
    response.status(404).json({ error: 'The assistant is only available in the local fictional demo.' });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    response.status(503).json({ error: 'The optional AI assistant is not configured. Deterministic campaign checks remain available.' });
    return;
  }
  const body: unknown = request.body;
  const message = typeof body === 'object' && body !== null && 'message' in body
    ? (body as { message?: unknown }).message : undefined;
  const proposalPermission = typeof body === 'object' && body !== null && 'allowProposal' in body
    ? (body as { allowProposal?: unknown }).allowProposal : false;
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 2000) {
    response.status(400).json({ error: 'Enter a message between 1 and 2000 characters.' });
    return;
  }
  if (typeof proposalPermission !== 'boolean') {
    response.status(400).json({ error: 'Proposal permission must be explicitly enabled or disabled.' });
    return;
  }
  if (activeAssistantRequests >= maxActiveAssistantRequests) {
    response.set('Retry-After', '2').status(429).json({ error: 'The assistant is busy. Retry in a moment.' });
    return;
  }

  activeAssistantRequests += 1;
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
    const result: CampaignAssistantResponse = await runCampaignAssistant(message.trim(), graph, {
      canSeedFixture: canSeedFixture(localDemoConfigFromEnvironment(process.env)),
      canPropose: proposalPermission,
      proposalMode: 'preview',
      persistChecks: true,
    }, { apiKey, model: process.env.OPENAI_MODEL });
    response.json(result);
  } catch (error) {
    if (error instanceof AssistantUnavailableError) {
      response.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof AssistantServiceError) {
      response.status(502).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_assistant_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The assistant could not complete this request. Campaign evidence remains available.' });
  } finally {
    activeAssistantRequests -= 1;
  }
});

function safeErrorDetails(error: unknown): { errorName: string; errorCode?: string } {
  const rawName = error instanceof Error ? error.name : 'UnknownError';
  const errorName = /^[A-Za-z0-9_]{1,40}$/.test(rawName) ? rawName : 'Error';
  const rawCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const errorCode = typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(rawCode) ? rawCode : undefined;
  return { errorName, ...(errorCode ? { errorCode } : {}) };
}

async function requireFixtureReady(
  graph: Graph,
  campaignId: string,
  response: express.Response,
): Promise<boolean> {
  if (campaignId !== 'campaign-csv-launch' || await isFixtureReady(graph)) return true;
  response.status(503).json({ error: 'The local campaign fixture is still initializing. Retry this request.' });
  return false;
}

app.get('/api/health', async (_request, response) => {
  try {
    const graph = await requestGraph();
    await graph.query('RETURN 1 AS healthy');
    response.json({ status: 'ok', falkorDb: 'connected' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'graph_health_failed', operation: 'readiness_query', ...safeErrorDetails(error) }));
    response.status(503).json({ status: 'unavailable', falkorDb: 'disconnected' });
  }
});

app.get('/api/campaigns/:campaignId/review', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Campaign not found in the local fictional campaign.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    const result = await checkCampaign(graph, request.params.campaignId);
    response.json(result);
  } catch (error) {
    if (error instanceof CampaignDataIntegrityError) {
      response.status(422).json({ error: 'Campaign drafts need unique graph IDs before this campaign can be checked.' });
      return;
    }
    if (error instanceof CampaignLimitError) {
      response.status(422).json({ error: error.message });
      return;
    }
    if (error instanceof CampaignCheckCapacityError) {
      response.set('Retry-After', '2').status(429).json({ error: error.message });
      return;
    }
    if (error instanceof CampaignChangedDuringCheckError) {
      response.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message === 'Campaign not found in FalkorDB.') {
      response.status(404).json({ error: 'Campaign not found. Enable the local fixture or load campaign data.' });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_review_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'FalkorDB could not complete this check. Drafts have not changed.' });
  }
});

app.post('/api/campaigns/:campaignId/check', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Persistent checks are only available for the local fictional campaign.' });
    return;
  }

  try {
    const graph = await requestGraph();
    await seedFixtureIfMissing(graph);
    const review = await checkCampaign(graph, request.params.campaignId);
    const activity = await recordCampaignCheck(graph, review);
    response.json({ review, activity });
  } catch (error) {
    if (error instanceof CampaignDataIntegrityError) {
      response.status(422).json({ error: 'Campaign drafts need unique graph IDs before this campaign can be checked.' });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_check_persistence_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The campaign check or its history could not be confirmed. Run a fresh check before relying on earlier findings.' });
  }
});

app.get('/api/campaigns/:campaignId/activity', async (request, response) => {
  if (request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Activity history is only available for the local fictional campaign.' });
    return;
  }

  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    response.set('Cache-Control', 'no-store').json(await listCampaignActivity(graph, request.params.campaignId));
  } catch (error) {
    console.error(JSON.stringify({ event: 'campaign_activity_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'Campaign activity history is unavailable.' });
  }
});

app.get('/api/campaigns/:campaignId/proposals', async (request, response) => {
  if (request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Proposals are only available for the local fictional campaign.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    response.set('Cache-Control', 'no-store').json(await listCampaignProposals(graph, request.params.campaignId));
  } catch (error) {
    console.error(JSON.stringify({ event: 'campaign_proposals_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'Campaign proposals are unavailable.' });
  }
});

app.post('/api/campaigns/:campaignId/drafts/:draftId/proposals', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch'
    || !/^draft-[a-z0-9-]{1,80}$/.test(request.params.draftId)) {
    response.status(404).json({ error: 'Proposal creation is only available for a local fictional draft.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    const proposal = await proposeCampaignAction(
      graph,
      request.params.campaignId,
      request.params.draftId,
      parseCreateProposalInput(request.body),
    );
    response.status(201).json(proposal);
  } catch (error) {
    if (error instanceof ReviewWorkflowError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_proposal_create_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The proposal could not be saved.' });
  }
});

app.post('/api/campaigns/:campaignId/proposals/:proposalId/approve', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch'
    || !/^[0-9a-f-]{36}$/i.test(request.params.proposalId)) {
    response.status(404).json({ error: 'Proposal approval is only available for a local fictional proposal.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    await approveCampaignProposal(graph, request.params.campaignId, request.params.proposalId);
    response.status(204).end();
  } catch (error) {
    if (error instanceof ReviewWorkflowError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_proposal_approval_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The proposal could not be confirmed or applied.' });
  }
});

app.post('/api/campaigns/:campaignId/proposals/:proposalId/reject', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch'
    || !/^[0-9a-f-]{36}$/i.test(request.params.proposalId)) {
    response.status(404).json({ error: 'Proposal rejection is only available for a local fictional proposal.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    await rejectCampaignProposal(graph, request.params.campaignId, request.params.proposalId);
    response.status(204).end();
  } catch (error) {
    if (error instanceof ReviewWorkflowError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_proposal_rejection_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The proposal could not be rejected.' });
  }
});

app.post('/api/campaigns/:campaignId/drafts/:draftId/resume', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch'
    || !/^draft-[a-z0-9-]{1,80}$/.test(request.params.draftId)) {
    response.status(404).json({ error: 'Draft resume is only available for the local fictional campaign.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, request.params.campaignId, response)) return;
    await resumeCampaignDraft(graph, request.params.campaignId, request.params.draftId);
    response.status(204).end();
  } catch (error) {
    if (error instanceof ReviewWorkflowError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_draft_resume_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The draft could not be resumed.' });
  }
});

app.post('/api/campaigns/:campaignId/fixture', async (request, response) => {
  if (!fixtureInitializationAllowed(request) || request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Fixture initialization is only available for the local fictional campaign.' });
    return;
  }

  try {
    const graph = await requestGraph();
    await seedFixtureIfMissing(graph);
    response.status(204).end();
  } catch (error) {
    console.error(JSON.stringify({ event: 'fixture_initialization_failed', ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The local fictional campaign could not be initialized.' });
  }
});

app.post('/api/campaigns/:campaignId/demo-rollout', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'This demo control is only available for the local fictional campaign.' });
    return;
  }

  const expanded = typeof request.body === 'object' && request.body !== null && 'expanded' in request.body
    ? (request.body as { expanded?: unknown }).expanded : undefined;
  if (typeof expanded !== 'boolean') {
    response.status(400).json({ error: 'Choose whether access should include all accounts.' });
    return;
  }

  try {
    const graph = await requestGraph();
    await seedFixtureIfMissing(graph);
    if (expanded) await expandDemoRollout(graph);
    else await restoreDemoRollout(graph);
    const review = await checkCampaign(graph, request.params.campaignId);
    await recordCampaignCheck(graph, review);
    response.json(review);
  } catch (error) {
    if (error instanceof CampaignDataIntegrityError) {
      response.status(422).json({ error: 'Campaign drafts need unique graph IDs before this campaign can be checked.' });
      return;
    }
    console.error(JSON.stringify({ event: 'demo_rollout_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The rollout update or its follow-up check could not be confirmed. Run a fresh campaign check before relying on any earlier finding.' });
  }
});

app.post('/api/campaigns/:campaignId/demo-test-state', async (request, response) => {
  if (!demoWritesEnabled(request) || request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'This demo control is only available for the local fictional campaign.' });
    return;
  }
  const available = typeof request.body === 'object' && request.body !== null && 'available' in request.body
    ? (request.body as { available?: unknown }).available : undefined;
  if (typeof available !== 'boolean') {
    response.status(400).json({ error: 'Test availability must be explicitly enabled or disabled.' });
    return;
  }

  try {
    const graph = await requestGraph();
    await seedFixtureIfMissing(graph);
    await setDemoTestAvailability(graph, available);
    const review = await checkCampaign(graph, request.params.campaignId);
    await recordCampaignCheck(graph, review);
    response.set('Cache-Control', 'no-store').json(review);
  } catch (error) {
    if (error instanceof CampaignDataIntegrityError) {
      response.status(422).json({ error: 'Campaign drafts need unique graph IDs before this campaign can be checked.' });
      return;
    }
    console.error(JSON.stringify({ event: 'demo_test_state_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The test scenario update or its follow-up check could not be confirmed. Run a fresh campaign check before relying on earlier findings.' });
  }
});

app.get('/api/workspace', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const rawUnavailable = request.query.ownerUnavailable;
  if (rawUnavailable !== undefined && rawUnavailable !== 'true' && rawUnavailable !== 'false') {
    response.status(400).json({ error: 'The owner scenario must be true or false.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
    response.json(await loadWorkspace(graph, rawUnavailable === 'true'));
  } catch (error) {
    console.error(JSON.stringify({ event: 'workspace_read_failed', ...safeErrorDetails(error) }));
    response.status(error instanceof WorkspaceError ? error.statusCode : 503)
      .json({ error: error instanceof WorkspaceError ? error.message : 'The connected workspace could not be loaded.' });
  }
});

app.post('/api/workspace/chat', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const body: unknown = request.body;
  const message = typeof body === 'object' && body !== null && 'message' in body
    ? (body as { message?: unknown }).message : undefined;
  const ownerUnavailable = typeof body === 'object' && body !== null && 'ownerUnavailable' in body
    ? (body as { ownerUnavailable?: unknown }).ownerUnavailable : false;
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 500 || typeof ownerUnavailable !== 'boolean') {
    response.status(400).json({ error: 'Enter a question up to 500 characters and a valid scenario state.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
    const [snapshot, review] = await Promise.all([
      loadWorkspace(graph, ownerUnavailable), checkCampaign(graph, 'campaign-csv-launch'),
    ]);
    response.json(answerWorkspaceQuestion(message.trim(), snapshot, review));
  } catch (error) {
    console.error(JSON.stringify({ event: 'workspace_chat_failed', ...safeErrorDetails(error) }));
    response.status(error instanceof WorkspaceError ? error.statusCode : 503)
      .json({ error: error instanceof WorkspaceError ? error.message : 'The workspace agent could not check the current graph.' });
  }
});

for (const [path, operation] of [
  ['/api/workspace/memory/approve-tone', approveTone],
  ['/api/workspace/memory/run-writer', runWriterSession],
  ['/api/workspace/company/propose-backup', proposeBackup],
  ['/api/workspace/company/approve-backup', approveBackup],
] as const) {
  app.post(path, async (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!demoWritesEnabled(request)) {
      response.status(404).json({ error: 'This action is available only in the fictional reviewer demo.' });
      return;
    }
    try {
      const graph = await requestGraph();
      if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
      await operation(graph);
      response.json(await loadWorkspace(graph));
    } catch (error) {
      console.error(JSON.stringify({ event: 'workspace_action_failed', ...safeErrorDetails(error) }));
      response.status(error instanceof WorkspaceError ? error.statusCode : 503)
        .json({ error: error instanceof WorkspaceError ? error.message : 'The workspace action could not be confirmed.' });
    }
  });
}

app.post('/api/workspace/demo/reset', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (!demoWritesEnabled(request)) {
    response.status(404).json({ error: 'Reset is available only in the fictional reviewer demo.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
    await restoreDemoRollout(graph);
    await setDemoTestAvailability(graph, true);
    await resetWorkspaceDemo(graph);
    response.json(await loadWorkspace(graph));
  } catch (error) {
    console.error(JSON.stringify({ event: 'workspace_demo_reset_failed', ...safeErrorDetails(error) }));
    response.status(error instanceof WorkspaceError ? error.statusCode : 503)
      .json({ error: error instanceof WorkspaceError ? error.message : 'The fictional demo could not be reset.' });
  }
});

app.post('/api/workspace/memory/drafts/:draftId/:decision', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (!demoWritesEnabled(request)) {
    response.status(404).json({ error: 'Draft review is available only in the fictional reviewer demo.' });
    return;
  }
  if (request.params.decision !== 'approve' && request.params.decision !== 'reject') {
    response.status(400).json({ error: 'Choose approve or reject.' });
    return;
  }
  try {
    const graph = await requestGraph();
    if (!await requireFixtureReady(graph, 'campaign-csv-launch', response)) return;
    await reviewWriterDraft(graph, request.params.draftId, request.params.decision);
    response.json(await loadWorkspace(graph));
  } catch (error) {
    console.error(JSON.stringify({ event: 'writer_draft_review_failed', ...safeErrorDetails(error) }));
    response.status(error instanceof WorkspaceError ? error.statusCode : 503)
      .json({ error: error instanceof WorkspaceError ? error.message : 'The writer draft could not be reviewed.' });
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const candidate = typeof error === 'object' && error !== null ? error as { status?: unknown; statusCode?: unknown } : {};
  const parserStatus = candidate.status ?? candidate.statusCode;
  const status = parserStatus === 400 || parserStatus === 413 || parserStatus === 415 ? parserStatus : 500;
  console.error(JSON.stringify({ event: 'request_failed', status, ...safeErrorDetails(error) }));
  const message = status === 413
    ? 'Request body is too large.'
    : status === 415 ? 'Request content type or encoding is unsupported.'
      : status === 400 ? 'Request body is invalid.' : 'Request could not be processed.';
  response.status(status).json({ error: message });
});

export default app;
