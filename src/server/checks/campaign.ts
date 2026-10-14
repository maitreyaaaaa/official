import type { Graph } from 'falkordb';
import type { CampaignReview, DraftFinding, EvidenceItem } from '../../shared/contracts.js';

type Row = unknown[];
interface DeploymentFact { id: string; revision: string; environment: string; includesFeature: boolean; reviewed: boolean; evidence: EvidenceItem[]; }
interface RolloutFact { id: string; name: string; environment: string; reviewed: boolean; includedIds: string[]; excludedIds: string[]; evidence: EvidenceItem[]; }
interface TestFact { id: string; revision: string; environment: string; passed: boolean; reviewed: boolean; evidence: EvidenceItem[]; }
interface FeatureFacts { deployments: DeploymentFact[]; rollouts: RolloutFact[]; tests: TestFact[]; }

const MAX_FACT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const campaignIdQuery = `
MATCH (campaign:Campaign {id: $campaignId})
RETURN campaign.id, campaign.name, campaign.audience, campaign.environment
LIMIT 1`;

const draftQuery = `
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft)
OPTIONAL MATCH (draft)-[:MAKES_PROMISE]->(directPromise:Promise)
OPTIONAL MATCH (draft)-[:REUSES_DRAFT]->(reusedDraft:Draft)-[:MAKES_PROMISE]->(reusedPromise:Promise)
WITH campaign, draft, coalesce(directPromise, reusedPromise) AS promise, reusedDraft
OPTIONAL MATCH (promise)-[:ABOUT]->(feature:Feature)
OPTIONAL MATCH (promise)-[:TARGETS]->(audience:Audience)
RETURN DISTINCT draft.id, draft.title, draft.kind, draft.text, draft.status,
       promise.id, promise.text, promise.reviewed,
       feature.id, feature.name, audience.id, audience.name, reusedDraft.id, reusedDraft.title,
       directPromise.id IS NOT NULL, reusedPromise.id IS NOT NULL
ORDER BY draft.position`;

const deploymentQuery = `
MATCH (:Feature {id: $featureId})-[:RUNNING_AS]->(fact:Deployment {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
RETURN fact.id, fact.revision, fact.environment, fact.includesFeature, fact.reviewed,
       source.id, source.label, source.text, source.observedAt, source.reviewedBy`;

const rolloutQuery = `
MATCH (:Feature {id: $featureId})-[:HAS_ROLLOUT]->(fact:Rollout {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
OPTIONAL MATCH (fact)-[:INCLUDES]->(included:Audience)
OPTIONAL MATCH (fact)-[:EXCLUDES]->(excluded:Audience)
RETURN fact.id, fact.name, fact.environment, fact.reviewed,
       collect(DISTINCT included.id), collect(DISTINCT excluded.id),
       source.id, source.label, source.text, source.observedAt, source.reviewedBy`;

const testQuery = `
MATCH (:Feature {id: $featureId})-[:HAS_TEST]->(fact:Test {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
RETURN fact.id, fact.revision, fact.environment, fact.passed, fact.reviewed,
       source.id, source.label, source.text, source.observedAt, source.reviewedBy`;

async function queryRows(graph: Graph, query: string, params: Record<string, string>): Promise<Row[]> {
  const result = await graph.query<Row>(query, { params });
  return result.data ?? [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function evidence(id: unknown, label: unknown, detail: unknown, kind: EvidenceItem['kind']): EvidenceItem {
  return { id: asString(id), label: asString(label), detail: asString(detail), kind, observedAt: '', reviewedBy: '' };
}

function evidenceFromRow(row: Row, offset: number, kind: EvidenceItem['kind']): EvidenceItem[] {
  if (!asString(row[offset])) return [];
  return [{
    ...evidence(row[offset], row[offset + 1], row[offset + 2], kind),
    observedAt: asString(row[offset + 3]),
    reviewedBy: asString(row[offset + 4]),
  }];
}

function mergeFactSources<T extends { id: string; evidence: EvidenceItem[] }>(facts: T[]): T[] {
  const byId = new Map<string, T>();
  let anonymousIndex = 0;
  for (const fact of facts) {
    const key = fact.id.trim() ? fact.id : `__missing_id_${anonymousIndex++}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...fact, evidence: [...fact.evidence] });
      continue;
    }
    const sourceIds = new Set(existing.evidence.map((item) => item.id));
    for (const source of fact.evidence) {
      if (!sourceIds.has(source.id)) {
        existing.evidence.push(source);
        sourceIds.add(source.id);
      }
    }
  }
  return [...byId.values()];
}

function hasFreshReviewedSource(sources: EvidenceItem[], checkedAt: Date): boolean {
  const now = checkedAt.getTime();
  if (!Number.isFinite(now)) return false;
  return sources.some((source) => {
    const observedAt = Date.parse(source.observedAt);
    return Boolean(source.id)
      && Boolean(source.reviewedBy.trim())
      && Number.isFinite(observedAt)
      && observedAt <= now + ALLOWED_FUTURE_CLOCK_SKEW_MS
      && now - observedAt <= MAX_FACT_AGE_MS;
  });
}

async function getFeatureFacts(graph: Graph, featureId: string): Promise<FeatureFacts> {
  const [deploymentRows, rolloutRows, testRows] = await Promise.all([
    queryRows(graph, deploymentQuery, { featureId }),
    queryRows(graph, rolloutQuery, { featureId }),
    queryRows(graph, testQuery, { featureId }),
  ]);

  const deployments = mergeFactSources(deploymentRows.map((row): DeploymentFact => ({
    id: asString(row[0]), revision: asString(row[1]), environment: asString(row[2]),
    includesFeature: asBoolean(row[3]), reviewed: asBoolean(row[4]),
    evidence: evidenceFromRow(row, 5, 'deployment'),
  })));
  const rollouts = mergeFactSources(rolloutRows.map((row): RolloutFact => ({
    id: asString(row[0]), name: asString(row[1]), environment: asString(row[2]), reviewed: asBoolean(row[3]),
    includedIds: asStringArray(row[4]), excludedIds: asStringArray(row[5]),
    evidence: evidenceFromRow(row, 6, 'rollout'),
  })));
  const tests = mergeFactSources(testRows.map((row): TestFact => ({
    id: asString(row[0]), revision: asString(row[1]), environment: asString(row[2]),
    passed: asBoolean(row[3]), reviewed: asBoolean(row[4]),
    evidence: evidenceFromRow(row, 5, 'test'),
  })));

  return { deployments, rollouts, tests };
}

function classifyPromise(
  promiseReviewed: boolean,
  audienceId: string,
  audienceName: string,
  environment: string,
  facts: FeatureFacts,
  checkedAt: Date,
): Pick<DraftFinding, 'status' | 'reason' | 'evidence'> {
  const allEvidence = [
    ...facts.deployments.flatMap((fact) => fact.evidence),
    ...facts.rollouts.flatMap((fact) => fact.evidence),
    ...facts.tests.flatMap((fact) => fact.evidence),
  ].filter((item) => item.id);
  const evidenceItems = [...new Map(allEvidence.map((item) => [item.id, item])).values()];

  if (!promiseReviewed) {
    return { status: 'Unknown', reason: 'This promise has not been reviewed by a person.', evidence: evidenceItems };
  }

  const currentRollouts = facts.rollouts.filter((fact) => fact.reviewed && fact.environment === environment);
  const unreviewedCurrentRollout = facts.rollouts.some((fact) => !fact.reviewed && fact.environment === environment);
  if (unreviewedCurrentRollout) {
    return { status: 'Unknown', reason: 'A current rollout record has not been reviewed by a person.', evidence: evidenceItems };
  }
  if (currentRollouts.some((fact) => !fact.id.trim())) {
    return { status: 'Unknown', reason: 'A current rollout is missing its stable graph ID.', evidence: evidenceItems };
  }
  if (currentRollouts.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return { status: 'Unknown', reason: 'A current rollout is missing a fresh source reviewed by a person.', evidence: evidenceItems };
  }
  const rolloutVerdicts = currentRollouts.map((fact) => {
    const included = fact.includedIds.includes(audienceId);
    const excluded = fact.excludedIds.includes(audienceId);
    if (included && excluded) return 'conflicting';
    return included ? 'included' : excluded ? 'excluded' : 'unspecified';
  });
  const hasConflictingRollouts = rolloutVerdicts.includes('conflicting') || new Set(rolloutVerdicts).size > 1;

  if (hasConflictingRollouts) {
    return { status: 'Unknown', reason: 'Current reviewed rollout records disagree about this audience.', evidence: evidenceItems };
  }

  if (rolloutVerdicts.includes('excluded')) {
    return { status: 'Contradicted', reason: `The current rollout excludes ${audienceName}.`, evidence: evidenceItems };
  }

  const currentDeployments = facts.deployments.filter((fact) => fact.environment === environment);
  if (currentDeployments.some((fact) => !fact.reviewed)) {
    return { status: 'Unknown', reason: 'A current deployment record has not been reviewed by a person.', evidence: evidenceItems };
  }
  if (currentDeployments.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return { status: 'Unknown', reason: 'A current deployment is missing a fresh source reviewed by a person.', evidence: evidenceItems };
  }
  if (currentDeployments.some((fact) => !fact.id.trim() || !fact.revision.trim())
    || new Set(currentDeployments.map((fact) => fact.revision)).size > 1
    || new Set(currentDeployments.map((fact) => fact.includesFeature)).size > 1) {
    return { status: 'Unknown', reason: 'Current deployment records disagree about the running revision or whether this feature is present.', evidence: evidenceItems };
  }
  const deployments = currentDeployments.filter((fact) => fact.includesFeature);
  const includesAudience = rolloutVerdicts.length > 0 && rolloutVerdicts.every((verdict) => verdict === 'included');

  if (!deployments.length) {
    return { status: 'Unknown', reason: `No current, reviewed ${environment} deployment includes this feature.`, evidence: evidenceItems };
  }
  if (!includesAudience) {
    return { status: 'Unknown', reason: `No current reviewed rollout confirms access for ${audienceName}.`, evidence: evidenceItems };
  }

  const relevantTests = facts.tests.filter((fact) =>
    fact.reviewed && fact.environment === environment && deployments.some((deployment) => deployment.revision === fact.revision),
  );
  if (facts.tests.some((fact) => !fact.reviewed && fact.environment === environment && deployments.some((deployment) => deployment.revision === fact.revision))) {
    return { status: 'Unknown', reason: 'A current test record for the running revision has not been reviewed by a person.', evidence: evidenceItems };
  }
  if (relevantTests.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return { status: 'Unknown', reason: 'A current test is missing a fresh source reviewed by a person.', evidence: evidenceItems };
  }
  if (relevantTests.some((fact) => !fact.id.trim())) {
    return { status: 'Unknown', reason: 'A current test record is missing its stable graph ID.', evidence: evidenceItems };
  }
  if (new Set(relevantTests.map((fact) => fact.passed)).size > 1) {
    return { status: 'Unknown', reason: 'Current reviewed test records disagree for the running revision.', evidence: evidenceItems };
  }
  const passingTest = relevantTests.some((fact) => fact.passed);
  if (!passingTest) {
    return { status: 'Unknown', reason: `No current passing ${environment} test is recorded for the running revision.`, evidence: evidenceItems };
  }

  return { status: 'Supported', reason: `Reviewed records confirm access for ${audienceName} and a passing test on the running revision.`, evidence: evidenceItems };
}

export async function checkCampaign(graph: Graph, campaignId: string, checkedAt = new Date()): Promise<CampaignReview> {
  const [campaignRows, draftRows] = await Promise.all([
    queryRows(graph, campaignIdQuery, { campaignId }),
    queryRows(graph, draftQuery, { campaignId }),
  ]);
  const campaignRow = campaignRows[0];
  if (!campaignRow) throw new Error('Campaign not found in FalkorDB.');

  const campaign = {
    id: asString(campaignRow[0]),
    name: asString(campaignRow[1]),
    audience: asString(campaignRow[2]),
    environment: asString(campaignRow[3]),
  };

  const featureIds = [...new Set(draftRows.map((row) => asString(row[8])).filter(Boolean))];
  const factEntries = await Promise.all(featureIds.map(async (id) => [id, await getFeatureFacts(graph, id)] as const));
  const factsByFeature = new Map(factEntries);

  const rowsByDraft = new Map<string, Row[]>();
  for (const row of draftRows) {
    const id = asString(row[0]);
    const rows = rowsByDraft.get(id) ?? [];
    rows.push(row);
    rowsByDraft.set(id, rows);
  }

  const findings = [...rowsByDraft.values()].map((rows): DraftFinding => {
    const row = rows[0];
    const draftId = asString(row[0]);
    const promiseId = asString(row[5]);
    const featureId = asString(row[8]);
    const audienceId = asString(row[10]);
    const audienceName = asString(row[11]);
    const hasPromise = Boolean(promiseId);

    if (!hasPromise) {
      return {
        draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
        promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Not checked',
        reason: 'No reviewed CSV export promise is linked to this draft.', evidence: [], needsReview: false,
      };
    }

    if (asBoolean(row[14]) && asBoolean(row[15])) {
      return {
        draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
        promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Unknown',
        reason: 'This draft has both a direct promise and a reused promise path.', evidence: [], needsReview: true,
      };
    }

    if (rows.length > 1) {
      return {
        draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
        promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Unknown',
        reason: 'More than one promise or audience path is linked to this draft.', evidence: [], needsReview: true,
      };
    }

    const result = featureId && audienceId
      ? classifyPromise(asBoolean(row[7]), audienceId, audienceName, campaign.environment, factsByFeature.get(featureId) ?? { deployments: [], rollouts: [], tests: [] }, checkedAt)
      : { status: 'Unknown' as const, reason: 'The reviewed promise is missing its feature or audience link.', evidence: [] };

    return {
      draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
      promiseText: asString(row[6]), wordingSourceTitle: asString(row[13]) || null,
      featureName: asString(row[9]), audienceName,
      ...result, needsReview: result.status === 'Contradicted' || result.status === 'Unknown',
    };
  });

  const proactiveItems = findings
    .filter((finding) => finding.needsReview)
    .map((finding) => ({
      id: finding.draftId,
      title: `${finding.title} needs review`,
      detail: finding.reason,
      status: finding.status as 'Contradicted' | 'Unknown',
    }));

  return { campaign, checkedAt: checkedAt.toISOString(), findings, proactiveItems };
}
