import type { Graph } from 'falkordb';
import { z } from 'zod/v4';
import { compareCampaignChecks, recordCampaignCheck } from '../activity/activity.js';
import { checkCampaign } from '../checks/campaign.js';
import { isFixtureReady, seedFixtureIfMissing } from '../graph/fixture.js';
import { parseCreateProposalInput, previewCampaignAction, proposeCampaignAction } from '../review/review.js';

const campaignId = 'campaign-csv-launch';

export interface CampaignAgentToolOptions {
  canSeedFixture: boolean;
  canPropose: boolean;
  proposalMode: 'preview' | 'persist';
  persistChecks: boolean;
}

interface CampaignAgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  openAiDefinition: Record<string, unknown>;
  execute(graph: Graph, input: unknown, options: CampaignAgentToolOptions): Promise<unknown>;
}

function defineTool<T>(definition: {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  openAiDefinition: Record<string, unknown>;
  run(graph: Graph, args: T, options: CampaignAgentToolOptions): Promise<unknown>;
}): CampaignAgentTool {
  return {
    name: definition.name,
    description: definition.description,
    schema: definition.schema,
    openAiDefinition: definition.openAiDefinition,
    execute: async (graph, input, options) => definition.run(graph, definition.schema.parse(input), options),
  };
}

async function requireCampaignFixture(graph: Graph, options: CampaignAgentToolOptions): Promise<void> {
  if (await isFixtureReady(graph)) return;
  if (!options.canSeedFixture) throw new Error('The fictional campaign fixture is not ready.');
  await seedFixtureIfMissing(graph);
}

function boundedText(value: string | null, limit = 600): string | null {
  return value ? value.slice(0, limit) : null;
}

function findingForAgent(finding: Awaited<ReturnType<typeof checkCampaign>>['findings'][number]) {
  return {
    draftId: finding.draftId,
    draftState: finding.draftState ?? 'draft',
    title: boundedText(finding.title, 120),
    kind: boundedText(finding.kind, 80),
    draftText: boundedText(finding.text),
    promiseText: boundedText(finding.promiseText),
    featureId: finding.featureId ?? null,
    audienceId: finding.audienceId ?? null,
    status: finding.status,
    reason: boundedText(finding.reason, 500),
    evidence: finding.evidence.slice(0, 6).map((item) => ({
      id: item.id,
      label: boundedText(item.label, 120),
      detail: boundedText(item.detail, 500),
      observedAt: item.observedAt,
      reviewedBy: boundedText(item.reviewedBy, 100),
    })),
  };
}

const checkCampaignSchema = z.object({}).strict();
const explainPromiseSchema = z.object({
  draftId: z.string().regex(/^draft-[a-z0-9-]{1,80}$/),
}).strict();
const findAffectedSchema = z.object({
  featureId: z.enum(['feature-csv-export']),
}).strict();
const compareChecksSchema = z.object({
  leftRunId: z.string().uuid(),
  rightRunId: z.string().uuid(),
}).strict();
const proposeDraftActionSchema = z.object({
  action: z.enum(['pause', 'edit']),
  draftId: z.string().regex(/^draft-[a-z0-9-]{1,80}$/),
  reason: z.string().min(1).max(500),
  proposedText: z.string().max(600).nullable(),
  targetAudienceId: z.string().regex(/^audience-[a-z0-9-]{1,80}$/).nullable(),
}).strict();

export const campaignAgentTools: CampaignAgentTool[] = [
  defineTool({
    name: 'check_campaign',
    description: 'Run the deterministic evidence check for the fictional CSV export campaign. Use this for current campaign status. It does not edit drafts.',
    schema: checkCampaignSchema,
    openAiDefinition: {
      type: 'function', name: 'check_campaign',
      description: 'Run the deterministic evidence check for the fictional CSV export campaign. Use this for current campaign status. It does not edit drafts.',
      strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    async run(graph, _args, options) {
      await requireCampaignFixture(graph, options);
      const review = await checkCampaign(graph, campaignId);
      const activity = options.persistChecks ? await recordCampaignCheck(graph, review) : undefined;
      return {
        campaign: review.campaign,
        checkedAt: review.checkedAt,
        ...(activity ? { runId: activity.runId } : {}),
        findings: review.findings.map(findingForAgent),
      };
    },
  }),
  defineTool({
    name: 'explain_promise',
    description: 'Check one draft and return its linked promise, status, evidence, and reason from the graph.',
    schema: explainPromiseSchema,
    openAiDefinition: {
      type: 'function', name: 'explain_promise',
      description: 'Check one draft and return its linked promise, status, evidence, and reason from the graph.',
      strict: true, parameters: {
        type: 'object', properties: { draftId: { type: 'string', pattern: '^draft-[a-z0-9-]{1,80}$' } },
        required: ['draftId'], additionalProperties: false,
      },
    },
    async run(graph, args, options) {
      await requireCampaignFixture(graph, options);
      const review = await checkCampaign(graph, campaignId);
      const finding = review.findings.find((item) => item.draftId === args.draftId);
      if (!finding) throw new Error('The draft was not found in the fictional campaign.');
      return { checkedAt: review.checkedAt, finding: findingForAgent(finding) };
    },
  }),
  defineTool({
    name: 'find_affected_drafts',
    description: 'Follow the campaign graph from one product feature to every linked draft and return each current finding.',
    schema: findAffectedSchema,
    openAiDefinition: {
      type: 'function', name: 'find_affected_drafts',
      description: 'Follow the campaign graph from one product feature to every linked draft and return each current finding.',
      strict: true, parameters: {
        type: 'object', properties: { featureId: { type: 'string', enum: ['feature-csv-export'] } },
        required: ['featureId'], additionalProperties: false,
      },
    },
    async run(graph, args, options) {
      await requireCampaignFixture(graph, options);
      const review = await checkCampaign(graph, campaignId);
      return {
        campaignId,
        featureId: args.featureId,
        checkedAt: review.checkedAt,
        drafts: review.findings.filter((item) => item.featureId === args.featureId).map(findingForAgent),
      };
    },
  }),
  defineTool({
    name: 'compare_checks',
    description: 'Compare two saved status-only check runs and return which draft findings changed.',
    schema: compareChecksSchema,
    openAiDefinition: {
      type: 'function', name: 'compare_checks',
      description: 'Compare two saved status-only check runs and return which draft findings changed.',
      strict: true, parameters: {
        type: 'object', properties: {
          leftRunId: { type: 'string', format: 'uuid' },
          rightRunId: { type: 'string', format: 'uuid' },
        }, required: ['leftRunId', 'rightRunId'], additionalProperties: false,
      },
    },
    async run(graph, args) {
      return compareCampaignChecks(graph, campaignId, args.leftRunId, args.rightRunId);
    },
  }),
  defineTool({
    name: 'propose_draft_action',
    description: 'Prepare a pause or wording proposal for a currently contradicted draft. In the assistant, this returns an unsaved preview that requires a user click to create a pending proposal. In MCP, an explicit tool call creates a pending proposal. Neither mode can apply it.',
    schema: proposeDraftActionSchema,
    openAiDefinition: {
      type: 'function', name: 'propose_draft_action',
      description: 'Prepare a pause or wording proposal for a currently contradicted draft. This returns an unsaved preview; a user must explicitly create the pending proposal after reviewing it. This tool cannot apply it.',
      strict: true, parameters: {
        type: 'object', properties: {
          action: { type: 'string', enum: ['pause', 'edit'] },
          draftId: { type: 'string', pattern: '^draft-[a-z0-9-]{1,80}$' },
          reason: { type: 'string' },
          proposedText: { type: ['string', 'null'] },
          targetAudienceId: { type: ['string', 'null'] },
        }, required: ['action', 'draftId', 'reason', 'proposedText', 'targetAudienceId'], additionalProperties: false,
      },
    },
    async run(graph, args, options) {
      if (!options.canPropose) throw new Error('Proposal creation is disabled for this environment.');
      await requireCampaignFixture(graph, options);
      const input = parseCreateProposalInput(args);
      if (options.proposalMode !== 'persist') {
        const proposalPreview = await previewCampaignAction(graph, campaignId, args.draftId, input);
        return { proposalPreview, persisted: false, approvalRequired: true, applied: false };
      }
      const proposal = await proposeCampaignAction(graph, campaignId, args.draftId, input);
      return { proposal, approvalRequired: true, applied: false };
    },
  }),
];

export function openAiCampaignTools(canPropose: boolean): Record<string, unknown>[] {
  return campaignAgentTools
    .filter((tool) => canPropose || tool.name !== 'propose_draft_action')
    .map((tool) => tool.openAiDefinition);
}

export async function executeCampaignAgentTool(
  name: string,
  graph: Graph,
  input: unknown,
  options: CampaignAgentToolOptions,
): Promise<unknown> {
  const tool = campaignAgentTools.find((item) => item.name === name);
  if (!tool) throw new Error('The requested agent tool is not available.');
  return tool.execute(graph, input, options);
}
