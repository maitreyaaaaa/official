import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { checkCampaign } from './checks/campaign.js';
import { closeGraph, getGraph } from './graph/client.js';
import { expandDemoRollout, seedFixtureIfMissing } from './graph/fixture.js';
import { canInitializeFixture, canWriteDemo } from './config/guards.js';

const app = express();

function fixtureInitializationAllowed(request: express.Request): boolean {
  return canInitializeFixture({
    nodeEnv: process.env.NODE_ENV,
    seedFixture: process.env.SEED_FIXTURE,
    graph: process.env.FALKORDB_GRAPH,
    falkordbHost: process.env.FALKORDB_HOST,
    port: Number(process.env.PORT || 3001),
  }, { remoteAddress: request.socket.remoteAddress, origin: request.get('origin') });
}

function demoWritesEnabled(request: express.Request): boolean {
  const port = Number(process.env.PORT || 3001);
  return canWriteDemo({
    nodeEnv: process.env.NODE_ENV,
    enableDemoWrites: process.env.ENABLE_DEMO_WRITES,
    graph: process.env.FALKORDB_GRAPH,
    falkordbHost: process.env.FALKORDB_HOST,
    port,
  }, { remoteAddress: request.socket.remoteAddress, origin: request.get('origin') });
}

function safeErrorDetails(error: unknown): { errorName: string; errorCode?: string } {
  const rawName = error instanceof Error ? error.name : 'UnknownError';
  const errorName = /^[A-Za-z0-9_]{1,40}$/.test(rawName) ? rawName : 'Error';
  const rawCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const errorCode = typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(rawCode) ? rawCode : undefined;
  return { errorName, ...(errorCode ? { errorCode } : {}) };
}

app.get('/api/health', async (_request, response) => {
  try {
    const graph = await getGraph();
    await graph.query('RETURN 1 AS healthy');
    response.json({ status: 'ok', falkorDb: 'connected' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'graph_health_failed', operation: 'readiness_query', ...safeErrorDetails(error) }));
    response.status(503).json({ status: 'unavailable', falkorDb: 'disconnected' });
  }
});

app.get('/api/campaigns/:campaignId/review', async (request, response) => {
  try {
    const graph = await getGraph();
    const result = await checkCampaign(graph, request.params.campaignId);
    response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Campaign not found in FalkorDB.') {
      response.status(404).json({ error: 'Campaign not found. Enable the local fixture or load campaign data.' });
      return;
    }
    console.error(JSON.stringify({ event: 'campaign_review_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'FalkorDB could not complete this check. Drafts have not changed.' });
  }
});

app.post('/api/campaigns/:campaignId/fixture', async (request, response) => {
  if (!fixtureInitializationAllowed(request) || request.params.campaignId !== 'campaign-csv-launch') {
    response.status(404).json({ error: 'Fixture initialization is only available for the local fictional campaign.' });
    return;
  }

  try {
    const graph = await getGraph();
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

  try {
    const graph = await getGraph();
    await seedFixtureIfMissing(graph);
    await expandDemoRollout(graph);
    response.json(await checkCampaign(graph, request.params.campaignId));
  } catch (error) {
    console.error(JSON.stringify({ event: 'demo_rollout_failed', campaignId: request.params.campaignId, ...safeErrorDetails(error) }));
    response.status(503).json({ error: 'The rollout update or its follow-up check could not be confirmed. Run a fresh campaign check before relying on any earlier finding.' });
  }
});

async function start(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The server requires NODE_ENV=development; serving stays disabled until authentication and authorization are implemented.');
  }

  const vite = await createViteServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const host = '127.0.0.1';
  const server = app.listen(port, host, () => {
    console.log(`official is listening on http://${host}:${port}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void closeGraph().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void start().catch((error: unknown) => {
  console.error('Could not start official.', error instanceof Error ? error.message : 'Unknown startup error.');
  process.exitCode = 1;
});
