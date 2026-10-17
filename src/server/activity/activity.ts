import { randomUUID } from 'node:crypto';
import type { Graph } from 'falkordb';
import type { ActivityEntry, CampaignReview } from '../../shared/contracts.js';

const activityQuery = `
MATCH (event:ActivityEvent {campaignId: $campaignId})
MATCH (campaign:Campaign {id: $campaignId})
WHERE event.occurredAt >= coalesce(campaign.demoResetAt, '')
RETURN event.id AS id, event.campaignId AS campaignId, event.kind AS kind,
       event.occurredAt AS occurredAt, event.title AS title, event.detail AS detail,
       event.runId AS runId
ORDER BY occurredAt DESC
LIMIT 20`;

const recordReviewQuery = `
CREATE (run:ReviewRun {id: $runId, campaignId: $campaignId, checkedAt: $checkedAt, findingsJson: $findingsJson})
CREATE (event:ActivityEvent {id: $eventId, campaignId: $campaignId, runId: $runId, kind: 'campaign.checked', occurredAt: $checkedAt, title: 'Campaign checked', detail: $detail})
CREATE (run)-[:GENERATED]->(event)
RETURN event.id AS eventId`;

const compareReviewRunsQuery = `
MATCH (left:ReviewRun {id: $leftRunId, campaignId: $campaignId})
MATCH (right:ReviewRun {id: $rightRunId, campaignId: $campaignId})
RETURN left.id AS leftRunId, left.checkedAt AS leftCheckedAt, left.findingsJson AS leftFindingsJson,
       right.id AS rightRunId, right.checkedAt AS rightCheckedAt, right.findingsJson AS rightFindingsJson
LIMIT 1`;

type GraphRecord = Record<string, unknown>;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeRows(result: { data?: unknown[] }, columns: string[]): GraphRecord[] {
  return (result.data ?? []).flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    if (Array.isArray(row)) {
      return [Object.fromEntries(columns.map((column, index) => [column, row[index]]))];
    }
    return [row as GraphRecord];
  });
}

export async function recordCampaignCheck(graph: Graph, review: CampaignReview): Promise<ActivityEntry & { runId: string }> {
  const runId = randomUUID();
  const eventId = randomUUID();
  const counts = {
    attention: review.findings.filter((finding) => finding.needsReview).length,
    supported: review.findings.filter((finding) => finding.status === 'Supported').length,
    unchecked: review.findings.filter((finding) => finding.status === 'Not checked').length,
  };
  const detail = `Checked ${review.findings.length} drafts: ${counts.attention} need review, ${counts.supported} supported, ${counts.unchecked} not checked.`;
  const findingsJson = JSON.stringify(review.findings.map(({ draftId, status }) => ({ draftId, status })));
  const result = await graph.query<Record<string, unknown>>(recordReviewQuery, {
    params: {
      runId,
      eventId,
      campaignId: review.campaign.id,
      checkedAt: review.checkedAt,
      findingsJson,
      detail,
    },
  });
  if (!normalizeRows(result, ['eventId']).length) {
    throw new Error('The campaign check could not be written to activity history.');
  }
  return {
    id: eventId,
    campaignId: review.campaign.id,
    kind: 'campaign.checked',
    occurredAt: review.checkedAt,
    title: 'Campaign checked',
    detail,
    runId,
  };
}

export async function listCampaignActivity(graph: Graph, campaignId: string): Promise<ActivityEntry[]> {
  const result = await graph.query<Record<string, unknown>>(activityQuery, { params: { campaignId } });
  return normalizeRows(result, ['id', 'campaignId', 'kind', 'occurredAt', 'title', 'detail', 'runId'])
    .map((row) => ({
      id: asText(row.id),
      campaignId: asText(row.campaignId),
      kind: asText(row.kind) as ActivityEntry['kind'],
      occurredAt: asText(row.occurredAt),
      title: asText(row.title),
      detail: asText(row.detail),
      ...(asText(row.runId) ? { runId: asText(row.runId) } : {}),
    }))
    .filter((entry) => entry.id && entry.campaignId === campaignId && entry.occurredAt
      && ['campaign.checked', 'rollout.expanded', 'demo.test_scenario.changed', 'proposal.created', 'proposal.approved', 'proposal.executed', 'proposal.rejected', 'proposal.needs_recheck', 'draft.resumed'].includes(entry.kind));
}

export interface CampaignCheckChange {
  draftId: string;
  leftStatus: string | null;
  rightStatus: string | null;
}

export interface CampaignCheckComparison {
  leftRunId: string;
  leftCheckedAt: string;
  rightRunId: string;
  rightCheckedAt: string;
  changes: CampaignCheckChange[];
}

function parseFindingSnapshot(value: unknown): Map<string, string> {
  if (typeof value !== 'string') throw new Error('The saved check does not contain a readable finding snapshot.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('The saved check contains an invalid finding snapshot.');
  }
  if (!Array.isArray(parsed)) throw new Error('The saved check contains an invalid finding snapshot.');
  const findings = new Map<string, string>();
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || !('draftId' in item) || !('status' in item)) continue;
    const draftId = asText(item.draftId);
    const status = asText(item.status);
    if (draftId && status) findings.set(draftId, status);
  }
  return findings;
}

export async function compareCampaignChecks(
  graph: Graph,
  campaignId: string,
  leftRunId: string,
  rightRunId: string,
): Promise<CampaignCheckComparison> {
  const result = await graph.query<Record<string, unknown>>(compareReviewRunsQuery, {
    params: { campaignId, leftRunId, rightRunId },
  });
  const row = normalizeRows(result, ['leftRunId', 'leftCheckedAt', 'leftFindingsJson', 'rightRunId', 'rightCheckedAt', 'rightFindingsJson'])[0];
  if (!row) throw new Error('One or both saved campaign checks could not be found.');
  const leftFindings = parseFindingSnapshot(row.leftFindingsJson);
  const rightFindings = parseFindingSnapshot(row.rightFindingsJson);
  const draftIds = new Set([...leftFindings.keys(), ...rightFindings.keys()]);
  const changes = [...draftIds].flatMap((draftId) => {
    const leftStatus = leftFindings.get(draftId) ?? null;
    const rightStatus = rightFindings.get(draftId) ?? null;
    return leftStatus === rightStatus ? [] : [{ draftId, leftStatus, rightStatus }];
  }).sort((a, b) => a.draftId.localeCompare(b.draftId));
  return {
    leftRunId: asText(row.leftRunId),
    leftCheckedAt: asText(row.leftCheckedAt),
    rightRunId: asText(row.rightRunId),
    rightCheckedAt: asText(row.rightCheckedAt),
    changes,
  };
}
