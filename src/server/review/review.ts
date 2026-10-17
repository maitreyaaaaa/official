import { randomUUID } from 'node:crypto';
import type { Graph } from 'falkordb';
import type { ActionProposal, CampaignProposalPreview, CampaignReview, DraftFinding, ProposalAction, ProposalStatus } from '../../shared/contracts.js';
import { recordCampaignCheck } from '../activity/activity.js';
import { assessDraftForAudience, checkCampaign, type CampaignAudienceAssessment } from '../checks/campaign.js';

export class ReviewWorkflowError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ReviewWorkflowError';
  }
}
const activeProposalDrafts = new Set<string>();

export interface CreateProposalInput {
  action: ProposalAction;
  proposedText: string | null;
  targetAudienceId: string | null;
  reason: string;
}

interface StoredProposal extends ActionProposal {
  featureId: string;
  draftRevision: number;
  factRevision: number;
  basisFingerprint: string;
  baselineText: string;
}

type GraphRecord = Record<string, unknown>;

const createProposalQuery = `
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft {id: $draftId})
MATCH (feature:Feature {id: $featureId})
MATCH (targetAudience:Audience {id: $targetAudienceId})
MATCH (run:ReviewRun {id: $runId, campaignId: $campaignId})
OPTIONAL MATCH (draft)-[:HAS_PROPOSAL]->(existing:ActionProposal {status: 'pending'})
WITH campaign, draft, feature, targetAudience, run, collect(existing) AS existingProposals
WHERE size(existingProposals) = 0
  AND coalesce(draft.status, 'draft') <> 'paused'
  AND coalesce(draft.officialRevision, 0) = $draftRevision
  AND coalesce(feature.factsRevision, 0) = $factRevision
  AND draft.text = $baselineText
CREATE (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId, draftId: $draftId,
       featureId: $featureId, targetAudienceId: $targetAudienceId,
       action: $action, proposedText: $proposedText, reason: $reason,
       status: 'pending', createdAt: $now, updatedAt: $now, baselineRunId: $runId,
       draftRevision: $draftRevision, factRevision: $factRevision,
       basisFingerprint: $basisFingerprint, baselineText: $baselineText})
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'proposal.created',
       occurredAt: $now, title: 'Draft action proposed', detail: $eventDetail, runId: $runId})
CREATE (campaign)-[:HAS_PROPOSAL]->(proposal)
CREATE (draft)-[:HAS_PROPOSAL]->(proposal)
CREATE (run)-[:BASIS_FOR]->(proposal)
CREATE (proposal)-[:HAS_EVENT]->(event)
RETURN proposal.id AS id`;

const proposalColumns = `
proposal.id AS id, proposal.campaignId AS campaignId, proposal.draftId AS draftId,
       proposal.action AS action, proposal.proposedText AS proposedText, proposal.reason AS reason,
       proposal.targetAudienceId AS targetAudienceId, proposal.status AS status,
       proposal.createdAt AS createdAt, proposal.updatedAt AS updatedAt,
       proposal.baselineRunId AS basedOnRunId`;

const listPendingProposalsQuery = `
MATCH (proposal:ActionProposal {campaignId: $campaignId, status: 'pending'})
RETURN ${proposalColumns}
ORDER BY createdAt DESC`;

const listRecentResolvedProposalsQuery = `
MATCH (proposal:ActionProposal {campaignId: $campaignId})
WHERE proposal.status <> 'pending'
RETURN ${proposalColumns}
ORDER BY createdAt DESC
LIMIT 20`;

const findProposalQuery = `
MATCH (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId})
RETURN proposal.id AS id, proposal.campaignId AS campaignId, proposal.draftId AS draftId,
       proposal.featureId AS featureId, proposal.targetAudienceId AS targetAudienceId,
       proposal.action AS action, proposal.proposedText AS proposedText,
       proposal.reason AS reason, proposal.status AS status, proposal.createdAt AS createdAt,
       proposal.updatedAt AS updatedAt, proposal.baselineRunId AS basedOnRunId,
       proposal.draftRevision AS draftRevision, proposal.factRevision AS factRevision,
       proposal.basisFingerprint AS basisFingerprint, proposal.baselineText AS baselineText
LIMIT 1`;

const markNeedsRecheckQuery = `
MATCH (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId, status: 'pending'})
SET proposal.status = 'needs_recheck', proposal.updatedAt = $now
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'proposal.needs_recheck',
       occurredAt: $now, title: 'Proposal needs a fresh review', detail: $detail})
CREATE (proposal)-[:HAS_EVENT]->(event)
RETURN proposal.id AS id`;

const approvePauseProposalQuery = `
MATCH (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId, status: 'pending'})
MATCH (draft:Draft)
WHERE draft.id = proposal.draftId
MATCH (draft)-[:IN_CAMPAIGN]->(campaign:Campaign)
WHERE campaign.id = $campaignId
WITH proposal, draft, campaign
MATCH (feature:Feature {id: proposal.featureId})
MATCH (run:ReviewRun {id: $runId, campaignId: $campaignId})
WHERE coalesce(draft.officialRevision, 0) = proposal.draftRevision
  AND coalesce(feature.factsRevision, 0) = proposal.factRevision
  AND draft.text = proposal.baselineText
  AND proposal.action = 'pause'
SET draft.status = 'paused',
    draft.officialRevision = coalesce(draft.officialRevision, 0) + 1,
    proposal.status = 'executed', proposal.updatedAt = $now
CREATE (approved:ActivityEvent {id: $approvedEventId, campaignId: $campaignId, kind: 'proposal.approved',
       occurredAt: $now, title: 'Proposal approved', detail: 'Approved in the local development workspace; reviewer identity is not verified.'})
CREATE (executed:ActivityEvent {id: $executedEventId, campaignId: $campaignId, kind: 'proposal.executed',
       occurredAt: $now, title: 'Draft action applied', detail: $executionDetail})
CREATE (proposal)-[:HAS_EVENT]->(approved)
CREATE (proposal)-[:HAS_EVENT]->(executed)
CREATE (run)-[:VALIDATED]->(proposal)
RETURN proposal.id AS id`;

const approveEditProposalQuery = `
MATCH (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId, status: 'pending'})
MATCH (draft:Draft)
WHERE draft.id = proposal.draftId
MATCH (draft)-[:IN_CAMPAIGN]->(campaign:Campaign)
WHERE campaign.id = $campaignId
WITH proposal, draft, campaign
MATCH (feature:Feature {id: proposal.featureId})
MATCH (audience:Audience {id: proposal.targetAudienceId})
MATCH (run:ReviewRun {id: $runId, campaignId: $campaignId})
OPTIONAL MATCH (draft)-[directLink:MAKES_PROMISE]->(:Promise)
WITH proposal, draft, feature, audience, run, collect(directLink) AS directLinks
OPTIONAL MATCH (draft)-[reuseLink:REUSES_DRAFT]->(:Draft)
WITH proposal, draft, feature, audience, run, directLinks, collect(reuseLink) AS reuseLinks
WHERE coalesce(draft.officialRevision, 0) = proposal.draftRevision
  AND coalesce(feature.factsRevision, 0) = proposal.factRevision
  AND draft.text = proposal.baselineText
  AND proposal.action = 'edit'
FOREACH (link IN directLinks | DELETE link)
FOREACH (link IN reuseLinks | DELETE link)
CREATE (promise:Promise {id: $promiseId, text: proposal.proposedText, reviewed: true})
CREATE (draft)-[:MAKES_PROMISE]->(promise)
CREATE (promise)-[:ABOUT]->(feature)
CREATE (promise)-[:TARGETS]->(audience)
SET draft.text = proposal.proposedText,
    draft.officialRevision = coalesce(draft.officialRevision, 0) + 1,
    proposal.status = 'executed', proposal.updatedAt = $now
CREATE (approved:ActivityEvent {id: $approvedEventId, campaignId: $campaignId, kind: 'proposal.approved',
       occurredAt: $now, title: 'Proposal approved', detail: 'Approved in the local development workspace; reviewer identity is not verified.'})
CREATE (executed:ActivityEvent {id: $executedEventId, campaignId: $campaignId, kind: 'proposal.executed',
       occurredAt: $now, title: 'Draft action applied', detail: $executionDetail})
CREATE (proposal)-[:HAS_EVENT]->(approved)
CREATE (proposal)-[:HAS_EVENT]->(executed)
CREATE (run)-[:VALIDATED]->(proposal)
RETURN proposal.id AS id`;

const rejectProposalQuery = `
MATCH (proposal:ActionProposal {id: $proposalId, campaignId: $campaignId, status: 'pending'})
SET proposal.status = 'rejected', proposal.updatedAt = $now
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'proposal.rejected',
       occurredAt: $now, title: 'Proposal rejected', detail: 'Rejected in the local development workspace; reviewer identity is not verified.'})
CREATE (proposal)-[:HAS_EVENT]->(event)
RETURN proposal.id AS id`;

const resumeDraftQuery = `
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft {id: $draftId})
MATCH (feature:Feature {id: $featureId})
WHERE draft.status = 'paused'
  AND coalesce(draft.officialRevision, 0) = $draftRevision
  AND coalesce(feature.factsRevision, 0) = $factRevision
SET draft.status = 'draft', draft.officialRevision = coalesce(draft.officialRevision, 0) + 1
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, kind: 'draft.resumed',
       occurredAt: $now, title: 'Draft resumed', detail: 'A reviewer resumed the draft after a fresh check.'})
CREATE (draft)-[:HAS_EVENT]->(event)
RETURN draft.id AS draftId`;

function normalizeRows(result: { data?: unknown[] }, columns: string[]): GraphRecord[] {
  return (result.data ?? []).flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    if (Array.isArray(row)) return [Object.fromEntries(columns.map((column, index) => [column, row[index]]))];
    return [row as GraphRecord];
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function proposalFromRow(row: GraphRecord): StoredProposal {
  return {
    id: text(row.id),
    campaignId: text(row.campaignId),
    draftId: text(row.draftId),
    featureId: text(row.featureId),
    action: text(row.action) as ProposalAction,
    proposedText: text(row.proposedText) || null,
    targetAudienceId: text(row.targetAudienceId),
    reason: text(row.reason),
    status: text(row.status) as ProposalStatus,
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    basedOnRunId: text(row.basedOnRunId),
    draftRevision: number(row.draftRevision),
    factRevision: number(row.factRevision),
    basisFingerprint: text(row.basisFingerprint),
    baselineText: text(row.baselineText),
  };
}

export function parseCreateProposalInput(value: unknown): CreateProposalInput {
  if (typeof value !== 'object' || value === null) {
    throw new ReviewWorkflowError(400, 'A proposal action and reason are required.');
  }
  const input = value as Record<string, unknown>;
  const action = input.action;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const proposedText = typeof input.proposedText === 'string' ? input.proposedText.trim() : '';
  const targetAudienceId = typeof input.targetAudienceId === 'string' ? input.targetAudienceId.trim() : '';
  if (action !== 'pause' && action !== 'edit') throw new ReviewWorkflowError(400, 'Choose a pause or edit proposal.');
  if (!reason || reason.length > 500) throw new ReviewWorkflowError(400, 'Proposal reasons must be between 1 and 500 characters.');
  if (action === 'edit' && (!proposedText || proposedText.length > 600)) {
    throw new ReviewWorkflowError(400, 'Edit proposals need suggested text between 1 and 600 characters.');
  }
  if (action === 'edit' && !/^audience-[a-z0-9-]{1,80}$/.test(targetAudienceId)) {
    throw new ReviewWorkflowError(400, 'Edit proposals must name a reviewed campaign audience.');
  }
  return { action, reason, proposedText: action === 'edit' ? proposedText : null, targetAudienceId: action === 'edit' ? targetAudienceId : null };
}

export function proposalMatchesFinding(proposal: StoredProposal, finding: DraftFinding): boolean {
  return proposal.status === 'pending'
    && finding.status === 'Contradicted'
    && finding.draftState !== 'paused'
    && proposal.draftId === finding.draftId
    && proposal.featureId === finding.featureId
    && proposal.draftRevision === finding.draftRevision
    && proposal.factRevision === finding.factRevision
    && proposal.basisFingerprint === finding.basisFingerprint;
}

export function requireSupportedTargetAudience(assessment: CampaignAudienceAssessment): void {
  if (assessment.status !== 'Supported') {
    throw new ReviewWorkflowError(409, `Edit proposals need a currently supported target audience. ${assessment.reason}`);
  }
}

export async function listCampaignProposals(graph: Graph, campaignId: string): Promise<ActionProposal[]> {
  const [pending, resolved] = await Promise.all([
    graph.query<Record<string, unknown>>(listPendingProposalsQuery, { params: { campaignId } }),
    graph.query<Record<string, unknown>>(listRecentResolvedProposalsQuery, { params: { campaignId } }),
  ]);
  return [...normalizeRows(pending, ['id', 'campaignId', 'draftId', 'action', 'proposedText', 'reason', 'targetAudienceId', 'status', 'createdAt', 'updatedAt', 'basedOnRunId']),
    ...normalizeRows(resolved, ['id', 'campaignId', 'draftId', 'action', 'proposedText', 'reason', 'targetAudienceId', 'status', 'createdAt', 'updatedAt', 'basedOnRunId'])]
    .map((row) => ({
      id: text(row.id),
      campaignId: text(row.campaignId),
      draftId: text(row.draftId),
      action: text(row.action) as ProposalAction,
      proposedText: text(row.proposedText) || null,
      targetAudienceId: text(row.targetAudienceId),
      reason: text(row.reason),
      status: text(row.status) as ProposalStatus,
      createdAt: text(row.createdAt),
      updatedAt: text(row.updatedAt),
      basedOnRunId: text(row.basedOnRunId),
    }));
}

interface PreparedCampaignProposal {
  review: CampaignReview;
  finding: DraftFinding & { featureId: string; basisFingerprint: string };
  targetAudienceId: string;
}

async function prepareCampaignProposal(
  graph: Graph,
  campaignId: string,
  draftId: string,
  input: CreateProposalInput,
  checkedAt = new Date(),
): Promise<PreparedCampaignProposal> {
  const review = await checkCampaign(graph, campaignId, checkedAt);
  const finding = review.findings.find((item) => item.draftId === draftId);
  if (!finding || finding.status !== 'Contradicted' || finding.draftState === 'paused' || !finding.featureId || !finding.basisFingerprint) {
    throw new ReviewWorkflowError(409, 'Only a currently contradicted draft can receive a proposal. Run a fresh check and review its evidence.');
  }
  const targetAudienceId = input.targetAudienceId ?? finding.audienceId;
  if (!targetAudienceId) throw new ReviewWorkflowError(409, 'This draft has no linked audience to target.');
  if (input.action === 'edit') {
    const assessment = await assessDraftForAudience(graph, review, finding, targetAudienceId, checkedAt);
    requireSupportedTargetAudience(assessment);
  }
  return { review, finding: finding as DraftFinding & { featureId: string; basisFingerprint: string }, targetAudienceId };
}

export async function previewCampaignAction(
  graph: Graph,
  campaignId: string,
  draftId: string,
  input: CreateProposalInput,
  checkedAt = new Date(),
): Promise<CampaignProposalPreview> {
  const { finding, targetAudienceId } = await prepareCampaignProposal(graph, campaignId, draftId, input, checkedAt);
  return {
    action: input.action,
    draftId,
    draftTitle: finding.title,
    proposedText: input.proposedText,
    targetAudienceId,
    reason: input.reason,
  };
}

async function createCampaignProposal(
  graph: Graph,
  campaignId: string,
  draftId: string,
  input: CreateProposalInput,
  checkedAt = new Date(),
): Promise<ActionProposal> {
  const { review, finding, targetAudienceId } = await prepareCampaignProposal(graph, campaignId, draftId, input, checkedAt);
  const run = await recordCampaignCheck(graph, review);
  const now = checkedAt.toISOString();
  const proposalId = randomUUID();
  const eventId = randomUUID();
  const eventDetail = input.action === 'pause'
    ? `Proposed pause for ${finding.title}: ${input.reason}`
    : `Proposed an internal draft edit for ${finding.title}: ${input.reason}`;
  const result = await graph.query<Record<string, unknown>>(createProposalQuery, {
    params: {
      campaignId,
      draftId,
      featureId: finding.featureId,
      targetAudienceId,
      runId: run.runId,
      proposalId,
      action: input.action,
      proposedText: input.proposedText ?? '',
      reason: input.reason,
      now,
      eventId,
      eventDetail,
      draftRevision: finding.draftRevision ?? 0,
      factRevision: finding.factRevision ?? 0,
      basisFingerprint: finding.basisFingerprint,
      baselineText: finding.text,
    },
  });
  if (!normalizeRows(result, ['id']).length) {
    const existing = await listCampaignProposals(graph, campaignId);
    if (existing.some((proposal) => proposal.draftId === draftId && proposal.status === 'pending')) {
      throw new ReviewWorkflowError(409, 'A proposal for this draft is already waiting for review. Resolve it before creating another.');
    }
    throw new ReviewWorkflowError(409, 'Draft or product facts changed while the proposal was being created. Run a fresh check.');
  }
  return {
    id: proposalId,
    campaignId,
    draftId,
    action: input.action,
    proposedText: input.proposedText,
    targetAudienceId,
    reason: input.reason,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    basedOnRunId: run.runId,
  };
}

export async function proposeCampaignAction(
  graph: Graph,
  campaignId: string,
  draftId: string,
  input: CreateProposalInput,
  checkedAt = new Date(),
): Promise<ActionProposal> {
  const lockKey = `${campaignId}:${draftId}`;
  if (activeProposalDrafts.has(lockKey)) {
    throw new ReviewWorkflowError(409, 'A proposal for this draft is already being created. Retry after the current request finishes.');
  }
  activeProposalDrafts.add(lockKey);
  try {
    return await createCampaignProposal(graph, campaignId, draftId, input, checkedAt);
  } finally {
    activeProposalDrafts.delete(lockKey);
  }
}

async function findStoredProposal(graph: Graph, campaignId: string, proposalId: string): Promise<StoredProposal> {
  const result = await graph.query<Record<string, unknown>>(findProposalQuery, { params: { campaignId, proposalId } });
  const row = normalizeRows(result, [
    'id', 'campaignId', 'draftId', 'featureId', 'targetAudienceId', 'action', 'proposedText', 'reason', 'status',
    'createdAt', 'updatedAt', 'basedOnRunId', 'draftRevision', 'factRevision', 'basisFingerprint', 'baselineText',
  ])[0];
  if (!row) throw new ReviewWorkflowError(404, 'Proposal not found.');
  return proposalFromRow(row);
}

async function markProposalStale(graph: Graph, campaignId: string, proposalId: string, detail: string): Promise<void> {
  const result = await graph.query<Record<string, unknown>>(markNeedsRecheckQuery, {
    params: { campaignId, proposalId, now: new Date().toISOString(), eventId: randomUUID(), detail },
  });
  if (!normalizeRows(result, ['id']).length) throw new ReviewWorkflowError(409, 'This proposal is no longer pending review.');
}

export async function approveCampaignProposal(graph: Graph, campaignId: string, proposalId: string): Promise<void> {
  const proposal = await findStoredProposal(graph, campaignId, proposalId);
  if (proposal.status !== 'pending') throw new ReviewWorkflowError(409, 'Only a pending proposal can be approved.');
  const review: CampaignReview = await checkCampaign(graph, campaignId);
  const run = await recordCampaignCheck(graph, review);
  const finding = review.findings.find((item) => item.draftId === proposal.draftId);
  if (!finding || !proposalMatchesFinding(proposal, finding)) {
    await markProposalStale(graph, campaignId, proposalId, 'Draft or product facts changed since this proposal was created. Create a new proposal after reviewing the fresh check.');
    throw new ReviewWorkflowError(409, 'The proposal is stale. A fresh check found changed draft or product facts; review the new finding before proposing another action.');
  }
  if (proposal.action === 'edit') {
    const assessment = await assessDraftForAudience(graph, review, finding, proposal.targetAudienceId, new Date(review.checkedAt));
    try {
      requireSupportedTargetAudience(assessment);
    } catch {
      await markProposalStale(graph, campaignId, proposalId, `The proposed audience is no longer supported. ${assessment.reason}`);
      throw new ReviewWorkflowError(409, `The proposed audience is no longer supported. The proposal needs a fresh review. ${assessment.reason}`);
    }
  }
  const now = new Date().toISOString();
  const query = proposal.action === 'pause' ? approvePauseProposalQuery : approveEditProposalQuery;
  const result = await graph.query<Record<string, unknown>>(query, {
    params: {
      campaignId,
      proposalId,
      promiseId: `promise-${proposalId}`,
      now,
      approvedEventId: randomUUID(),
      executedEventId: randomUUID(),
      executionDetail: proposal.action === 'pause' ? `Paused ${proposal.draftId} in the local campaign.` : `Updated ${proposal.draftId} in the local campaign.`,
      runId: run.runId,
    },
  });
  if (!normalizeRows(result, ['id']).length) {
    await markProposalStale(graph, campaignId, proposalId, 'Draft or product facts changed before the approved action could be applied.');
    throw new ReviewWorkflowError(409, 'Draft or product facts changed during approval. The proposal now needs a fresh review.');
  }
}

export async function rejectCampaignProposal(graph: Graph, campaignId: string, proposalId: string): Promise<void> {
  const result = await graph.query<Record<string, unknown>>(rejectProposalQuery, {
    params: { campaignId, proposalId, now: new Date().toISOString(), eventId: randomUUID() },
  });
  if (!normalizeRows(result, ['id']).length) throw new ReviewWorkflowError(409, 'Only a pending proposal can be rejected.');
}

export async function resumeCampaignDraft(graph: Graph, campaignId: string, draftId: string): Promise<void> {
  const review = await checkCampaign(graph, campaignId);
  const finding = review.findings.find((item) => item.draftId === draftId);
  if (!finding || finding.status !== 'Supported' || !finding.featureId) {
    throw new ReviewWorkflowError(409, 'A fresh check must support this draft before a reviewer can resume it.');
  }
  await recordCampaignCheck(graph, review);
  const result = await graph.query<Record<string, unknown>>(resumeDraftQuery, {
    params: {
      campaignId,
      draftId,
      featureId: finding.featureId,
      draftRevision: finding.draftRevision ?? 0,
      factRevision: finding.factRevision ?? 0,
      now: new Date().toISOString(),
      eventId: randomUUID(),
    },
  });
  if (!normalizeRows(result, ['draftId']).length) throw new ReviewWorkflowError(409, 'The draft or product facts changed during resume. Run a fresh check and try again.');
}
