import 'dotenv/config';
import { McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import {
  CampaignChangedDuringCheckError, CampaignCheckCapacityError, CampaignDataIntegrityError, CampaignLimitError,
} from '../checks/campaign.js';
import { canEnableDemoRollout, canSeedFixture } from '../config/guards.js';
import { closeGraph, getGraph } from '../graph/client.js';
import { ReviewWorkflowError } from '../review/review.js';
import { campaignAgentTools, executeCampaignAgentTool } from './tools.js';

function localConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    seedFixture: process.env.SEED_FIXTURE,
    enableDemoWrites: process.env.ENABLE_DEMO_WRITES,
    graph: process.env.FALKORDB_GRAPH,
    falkordbHost: process.env.FALKORDB_HOST,
  };
}

function safeToolError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'The tool arguments are invalid.';
  if (error instanceof ReviewWorkflowError
    || error instanceof CampaignChangedDuringCheckError
    || error instanceof CampaignCheckCapacityError
    || error instanceof CampaignDataIntegrityError
    || error instanceof CampaignLimitError) return error.message;
  return 'The graph tool could not complete. Check the local FalkorDB connection and retry.';
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'official-track-1', version: '0.1.0' });
  const config = localConfig();
  const options = {
    canSeedFixture: canSeedFixture(config),
    canPropose: canEnableDemoRollout(config),
    proposalMode: 'persist' as const,
    persistChecks: canEnableDemoRollout(config),
  };

  for (const tool of campaignAgentTools) {
    if (tool.name === 'propose_draft_action' && !options.canPropose) continue;
    server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(tool.name, {
      description: tool.description,
      annotations: {
        readOnlyHint: tool.name !== 'propose_draft_action'
          && !(tool.name === 'check_campaign' && options.persistChecks)
          && !(options.canSeedFixture && tool.name !== 'compare_checks'),
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: tool.schema as unknown as StandardSchemaWithJSON,
    }, async (input: unknown) => {
      try {
        const result = await executeCampaignAgentTool(tool.name, await getGraph(), input, options);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: safeToolError(error) }], isError: true };
      }
    });
  }

  return server;
}

const handle = serveStdio(createServer);
let shutdownPromise: Promise<void> | undefined;
const shutdown = (): void => {
  shutdownPromise ??= handle.close().catch(() => undefined).then(() => closeGraph());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.stdin.once('end', shutdown);

console.error('official Track 1 MCP server ready on stdio');
