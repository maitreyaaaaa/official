import type { Graph } from 'falkordb';
import { createHash } from 'node:crypto';
import type { CampaignReview, DraftFinding, EvidenceItem } from '../../shared/contracts.js';

type Row = unknown[];
export class CampaignDataIntegrityError extends Error {
  constructor() {
    super('Campaign drafts must have unique graph IDs before they can be checked.');
    this.name = 'CampaignDataIntegrityError';
  }
}
export class CampaignLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignLimitError';
  }
}
export class CampaignCheckCapacityError extends Error {
  constructor() {
    super('A campaign check is already running. Retry shortly.');
    this.name = 'CampaignCheckCapacityError';
  }
}
export class CampaignChangedDuringCheckError extends Error {
  constructor() {
    super('Campaign drafts or evidence changed while the check was running. Retry to get a fresh, consistent result.');
    this.name = 'CampaignChangedDuringCheckError';
  }
}
interface DeploymentFact { id: string; revision: string; environment: string; includesFeature: boolean; reviewed: boolean; evidence: EvidenceItem[]; conflicting: boolean; }
interface RolloutFact { id: string; name: string; environment: string; reviewed: boolean; includedIds: string[]; excludedIds: string[]; evidence: EvidenceItem[]; conflicting: boolean; }
interface TestFact { id: string; revision: string; environment: string; passed: boolean; reviewed: boolean; evidence: EvidenceItem[]; conflicting: boolean; }
interface FeatureFacts { deployments: DeploymentFact[]; rollouts: RolloutFact[]; tests: TestFact[]; }

const MAX_FACT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CAMPAIGN_DRAFTS = 100;
const MAX_CAMPAIGN_PROMISE_PATHS = 500;
const MAX_CAMPAIGN_FEATURES = 25;
const FEATURE_FACT_QUERY_CONCURRENCY = 4;
const MAX_CONCURRENT_CAMPAIGN_CHECKS = 2;
let activeCampaignChecks = 0;

const campaignIdQuery = `
MATCH (campaign:Campaign {id: $campaignId})
RETURN campaign.id AS campaignId, campaign.name AS campaignName,
       campaign.companyName AS campaignCompanyName, campaign.industry AS campaignIndustry,
       campaign.region AS campaignRegion, campaign.ownerTeam AS campaignOwnerTeam,
       campaign.releaseWindow AS campaignReleaseWindow,
       campaign.audience AS campaignAudience, campaign.environment AS campaignEnvironment
LIMIT 1`;

const draftIdentityQuery = `
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft)
RETURN draft.id AS draftId, count(DISTINCT draft) AS draftCount
LIMIT 101`;

const draftQuery = `
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft)
OPTIONAL MATCH (draft)-[:MAKES_PROMISE]->(directPromise:Promise)
OPTIONAL MATCH (draft)-[:REUSES_DRAFT]->(reusedDraft:Draft)-[:IN_CAMPAIGN]->(campaign)
OPTIONAL MATCH (reusedDraft)-[:MAKES_PROMISE]->(reusedPromise:Promise)
WITH campaign, draft, directPromise, reusedPromise,
     coalesce(directPromise, reusedPromise) AS promise, reusedDraft
OPTIONAL MATCH (promise)-[:ABOUT]->(feature:Feature)
OPTIONAL MATCH (promise)-[:TARGETS]->(audience:Audience)
RETURN DISTINCT draft.id AS draftId, draft.title AS draftTitle, draft.kind AS draftKind,
       draft.text AS draftText, draft.status AS draftStatus,
       promise.id AS promiseId, promise.text AS promiseText, promise.reviewed AS promiseReviewed,
       feature.id AS featureId, feature.name AS featureName,
       audience.id AS audienceId, audience.name AS audienceName,
       reusedDraft.id AS reusedDraftId, reusedDraft.title AS reusedDraftTitle,
       directPromise IS NOT NULL AS hasDirectPromise, reusedPromise IS NOT NULL AS hasReusedPromise,
       draft.position AS sortPosition, coalesce(draft.officialRevision, 0) AS draftRevision,
       coalesce(feature.factsRevision, 0) AS factRevision
ORDER BY sortPosition
LIMIT 501`;

function draftSnapshot(rows: Row[]): string {
  return rows.map((row) => JSON.stringify(row)).sort().join('\n');
}

const deploymentQuery = `
MATCH (:Feature {id: $featureId})-[:RUNNING_AS]->(fact:Deployment {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
RETURN fact.id AS factId, fact.revision AS revision, fact.environment AS environment,
       fact.includesFeature AS includesFeature, fact.reviewed AS reviewed,
       source.id AS sourceId, source.label AS sourceLabel, source.text AS sourceText,
       source.observedAt AS observedAt, source.reviewedBy AS reviewedBy`;

const rolloutQuery = `
MATCH (:Feature {id: $featureId})-[:HAS_ROLLOUT]->(fact:Rollout {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
OPTIONAL MATCH (fact)-[:INCLUDES]->(included:Audience)
OPTIONAL MATCH (fact)-[:EXCLUDES]->(excluded:Audience)
RETURN fact.id AS factId, fact.name AS factName, fact.environment AS environment, fact.reviewed AS reviewed,
       collect(DISTINCT included.id) AS includedIds, collect(DISTINCT excluded.id) AS excludedIds,
       source.id AS sourceId, source.label AS sourceLabel, source.text AS sourceText,
       source.observedAt AS observedAt, source.reviewedBy AS reviewedBy`;

const testQuery = `
MATCH (:Feature {id: $featureId})-[:HAS_TEST]->(fact:Test {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
RETURN fact.id AS factId, fact.revision AS revision, fact.environment AS environment,
       fact.passed AS passed, fact.reviewed AS reviewed,
       source.id AS sourceId, source.label AS sourceLabel, source.text AS sourceText,
       source.observedAt AS observedAt, source.reviewedBy AS reviewedBy`;

const campaignAudienceQuery = `
MATCH (:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(:Draft)-[:MAKES_PROMISE]->(promise:Promise)-[:ABOUT]->(:Feature {id: $featureId})
MATCH (promise)-[:TARGETS]->(audience:Audience {id: $audienceId})
WHERE coalesce(promise.reviewed, false) = true
RETURN DISTINCT audience.id AS audienceId, audience.name AS audienceName
LIMIT 1`;

async function queryRows(
  graph: Graph,
  query: string,
  params: Record<string, string>,
  columns: string[],
): Promise<Row[]> {
  const result = await graph.query<Record<string, unknown>>(query, { params });
  return ((result.data ?? []) as unknown[]).map((row) => {
    if (Array.isArray(row)) return row;
    if (typeof row !== 'object' || row === null) return [];
    return columns.map((column) => (row as Record<string, unknown>)[column]);
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function evidence(id: unknown, label: unknown, detail: unknown, kind: EvidenceItem['kind']): EvidenceItem {
  return { id: asString(id), label: asString(label), detail: asString(detail), kind, observedAt: '', reviewedBy: '' };
}

function evidenceFromRow(row: Row, offset: number, kind: EvidenceItem['kind']): EvidenceItem[] {
  if (!asString(row[offset]).trim()) return [];
  return [{
    ...evidence(row[offset], row[offset + 1], row[offset + 2], kind),
    observedAt: asString(row[offset + 3]),
    reviewedBy: asString(row[offset + 4]),
  }];
}

function sameEvidence(left: EvidenceItem, right: EvidenceItem): boolean {
  return left.label === right.label
    && left.detail === right.detail
    && left.observedAt === right.observedAt
    && left.reviewedBy === right.reviewedBy;
}

function sameStringValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function mergeFactSources<T extends { id: string; evidence: EvidenceItem[]; conflicting: boolean }>(
  facts: T[],
  sameFact: (left: T, right: T) => boolean,
): T[] {
  const byId = new Map<string, T>();
  let anonymousIndex = 0;
  for (const fact of facts) {
    const key = fact.id.trim() ? fact.id : `__missing_id_${anonymousIndex++}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...fact, evidence: [...fact.evidence] });
      continue;
    }
    if (!sameFact(existing, fact)) existing.conflicting = true;
    const sourcesById = new Map(existing.evidence.map((item) => [item.id, item]));
    for (const source of fact.evidence) {
      const existingSource = sourcesById.get(source.id);
      if (!existingSource) {
        existing.evidence.push(source);
        sourcesById.set(source.id, source);
      } else if (!sameEvidence(existingSource, source)) {
        existing.conflicting = true;
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
    return Boolean(source.id.trim())
      && Boolean(source.label.trim())
      && Boolean(source.detail.trim())
      && Boolean(source.reviewedBy.trim())
      && Number.isFinite(observedAt)
      && observedAt <= now + ALLOWED_FUTURE_CLOCK_SKEW_MS
      && now - observedAt <= MAX_FACT_AGE_MS;
  });
}

function evidenceForFacts(...groups: Array<Array<{ evidence: EvidenceItem[] }>>): EvidenceItem[] {
  const evidenceItems = groups.flatMap((group) => group.flatMap((fact) => fact.evidence))
    .filter((item) => item.id.trim());
  return [...new Map(evidenceItems.map((item) => [item.id, item])).values()];
}

function fingerprintFinding(
  finding: DraftFinding,
  row: Row,
  facts: FeatureFacts | undefined,
  environment: string,
  draftRevision: number,
  factRevision: number,
): string {
  const normalizeFacts = <T extends { id: string; evidence: EvidenceItem[] }>(items: T[]) => items
    .map((fact) => ({
      ...fact,
      evidence: [...fact.evidence].sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const basis = {
    draftId: finding.draftId,
    draftRevision,
    draftText: finding.text,
    promiseId: asString(row[5]),
    promiseText: finding.promiseText,
    featureId: asString(row[8]),
    audienceId: asString(row[10]),
    environment,
    factRevision,
    facts: facts ? {
      deployments: normalizeFacts(facts.deployments),
      rollouts: normalizeFacts(facts.rollouts),
      tests: normalizeFacts(facts.tests),
    } : null,
  };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex');
}

async function getFeatureFacts(graph: Graph, featureId: string): Promise<FeatureFacts> {
  const [deploymentRows, rolloutRows, testRows] = await Promise.all([
    queryRows(graph, deploymentQuery, { featureId }, [
      'factId', 'revision', 'environment', 'includesFeature', 'reviewed', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy',
    ]),
    queryRows(graph, rolloutQuery, { featureId }, [
      'factId', 'factName', 'environment', 'reviewed', 'includedIds', 'excludedIds', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy',
    ]),
    queryRows(graph, testQuery, { featureId }, [
      'factId', 'revision', 'environment', 'passed', 'reviewed', 'sourceId', 'sourceLabel', 'sourceText', 'observedAt', 'reviewedBy',
    ]),
  ]);

  const deployments = mergeFactSources(deploymentRows.map((row): DeploymentFact => ({
    id: asString(row[0]), revision: asString(row[1]), environment: asString(row[2]),
    includesFeature: asBoolean(row[3]), reviewed: asBoolean(row[4]),
    evidence: evidenceFromRow(row, 5, 'deployment'), conflicting: false,
  })), (left, right) => left.revision === right.revision
    && left.environment === right.environment
    && left.includesFeature === right.includesFeature
    && left.reviewed === right.reviewed);
  const rollouts = mergeFactSources(rolloutRows.map((row): RolloutFact => ({
    id: asString(row[0]), name: asString(row[1]), environment: asString(row[2]), reviewed: asBoolean(row[3]),
    includedIds: asStringArray(row[4]), excludedIds: asStringArray(row[5]),
    evidence: evidenceFromRow(row, 6, 'rollout'), conflicting: false,
  })), (left, right) => left.name === right.name
    && left.environment === right.environment
    && left.reviewed === right.reviewed
    && sameStringValues(left.includedIds, right.includedIds)
    && sameStringValues(left.excludedIds, right.excludedIds));
  const tests = mergeFactSources(testRows.map((row): TestFact => ({
    id: asString(row[0]), revision: asString(row[1]), environment: asString(row[2]),
    passed: asBoolean(row[3]), reviewed: asBoolean(row[4]),
    evidence: evidenceFromRow(row, 5, 'test'), conflicting: false,
  })), (left, right) => left.revision === right.revision
    && left.environment === right.environment
    && left.passed === right.passed
    && left.reviewed === right.reviewed);

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
  if (!promiseReviewed) {
    return { status: 'Unknown', reason: 'This promise has not been reviewed by a person.', evidence: [] };
  }

  const unscopedRollouts = facts.rollouts.filter((fact) => !fact.environment.trim());
  if (unscopedRollouts.length) {
    return {
      status: 'Unknown',
      reason: 'A current rollout has no environment, so it cannot be safely scoped to this campaign.',
      evidence: evidenceForFacts(unscopedRollouts),
    };
  }

  const currentRollouts = facts.rollouts.filter((fact) => fact.environment === environment);
  const currentDeployments = facts.deployments.filter((fact) => fact.environment === environment);
  const currentTests = facts.tests.filter((fact) => fact.environment === environment);
  const conflictingFacts = [...currentDeployments, ...currentRollouts, ...currentTests].filter((fact) => fact.conflicting);
  if (conflictingFacts.length) {
    return {
      status: 'Unknown',
      reason: 'Current graph facts with the same ID disagree about their data or source.',
      evidence: evidenceForFacts(conflictingFacts),
    };
  }

  const unreviewedCurrentRollout = currentRollouts.some((fact) => !fact.reviewed);
  if (unreviewedCurrentRollout) {
    return { status: 'Unknown', reason: 'A current rollout record has not been reviewed by a person.', evidence: evidenceForFacts(currentRollouts) };
  }
  if (currentRollouts.some((fact) => !fact.id.trim())) {
    return { status: 'Unknown', reason: 'A current rollout is missing its stable graph ID.', evidence: evidenceForFacts(currentRollouts) };
  }
  if (currentRollouts.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return { status: 'Unknown', reason: 'A current rollout is missing a fresh source reviewed by a person.', evidence: evidenceForFacts(currentRollouts) };
  }
  const rolloutVerdicts = currentRollouts.map((fact) => {
    const included = fact.includedIds.includes(audienceId);
    const excluded = fact.excludedIds.includes(audienceId);
    if (included && excluded) return 'conflicting';
    return included ? 'included' : excluded ? 'excluded' : 'unspecified';
  });
  const hasConflictingRollouts = rolloutVerdicts.includes('conflicting') || new Set(rolloutVerdicts).size > 1;

  if (hasConflictingRollouts) {
    return { status: 'Unknown', reason: 'Current reviewed rollout records disagree about this audience.', evidence: evidenceForFacts(currentRollouts) };
  }

  const hasKnownExclusion = rolloutVerdicts.includes('excluded');
  const exclusionReason = `The current rollout excludes ${audienceName}.`;
  const finish = (
    status: 'Supported' | 'Contradicted' | 'Unknown',
    reason: string,
    ...usedFacts: Array<Array<{ evidence: EvidenceItem[] }>>
  ): Pick<DraftFinding, 'status' | 'reason' | 'evidence'> => {
    if (hasKnownExclusion) {
      const details = status === 'Unknown' ? ` Additional gap: ${reason}` : '';
      return {
        status: 'Contradicted',
        reason: `${exclusionReason}${details}`,
        evidence: evidenceForFacts(currentRollouts),
      };
    }
    return { status, reason, evidence: evidenceForFacts(currentRollouts, ...usedFacts) };
  };

  const unscopedReadinessFacts = [...facts.deployments, ...facts.tests].filter((fact) => !fact.environment.trim());
  if (unscopedReadinessFacts.length) {
    return finish('Unknown', 'A current deployment or test has no environment and cannot be safely matched to this campaign.', unscopedReadinessFacts);
  }

  if (currentDeployments.some((fact) => !fact.reviewed)) {
    return finish('Unknown', 'A current deployment record has not been reviewed by a person.', currentDeployments);
  }
  if (currentDeployments.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return finish('Unknown', 'A current deployment is missing a fresh source reviewed by a person.', currentDeployments);
  }
  if (currentDeployments.some((fact) => !fact.id.trim() || !fact.revision.trim())
    || new Set(currentDeployments.map((fact) => fact.revision)).size > 1
    || new Set(currentDeployments.map((fact) => fact.includesFeature)).size > 1) {
    return finish('Unknown', 'Current deployment records disagree about the running revision or whether this feature is present.', currentDeployments);
  }
  const deployments = currentDeployments.filter((fact) => fact.includesFeature);
  const includesAudience = rolloutVerdicts.length > 0 && rolloutVerdicts.every((verdict) => verdict === 'included');

  if (!deployments.length) {
    return finish('Unknown', `No current, reviewed ${environment} deployment includes this feature.`, currentDeployments);
  }
  if (!includesAudience && !hasKnownExclusion) {
    return finish('Unknown', `No current reviewed rollout confirms access for ${audienceName}.`, currentRollouts, currentDeployments);
  }

  const relevantTests = currentTests.filter((fact) => deployments.some((deployment) => deployment.revision === fact.revision));
  if (relevantTests.some((fact) => !fact.reviewed)) {
    return finish('Unknown', 'A current test record for the running revision has not been reviewed by a person.', currentDeployments, relevantTests);
  }
  if (relevantTests.some((fact) => !hasFreshReviewedSource(fact.evidence, checkedAt))) {
    return finish('Unknown', 'A current test is missing a fresh source reviewed by a person.', currentDeployments, relevantTests);
  }
  if (relevantTests.some((fact) => !fact.id.trim())) {
    return finish('Unknown', 'A current test record is missing its stable graph ID.', currentDeployments, relevantTests);
  }
  if (new Set(relevantTests.map((fact) => fact.passed)).size > 1) {
    return finish('Unknown', 'Current reviewed test records disagree for the running revision.', currentDeployments, relevantTests);
  }
  const passingTest = relevantTests.some((fact) => fact.passed);
  if (!passingTest) {
    return finish('Unknown', `No current passing ${environment} test is recorded for the running revision.`, currentDeployments, relevantTests);
  }

  return hasKnownExclusion
    ? finish('Contradicted', exclusionReason, currentDeployments, relevantTests)
    : finish('Supported', `Reviewed records confirm access for ${audienceName} and a passing test on the running revision.`, currentRollouts, currentDeployments, relevantTests);
}

async function runCampaignCheck(graph: Graph, campaignId: string, checkedAt: Date): Promise<CampaignReview> {
  const [campaignRows, draftIdentityRows, draftRows] = await Promise.all([
    queryRows(graph, campaignIdQuery, { campaignId }, [
      'campaignId', 'campaignName', 'campaignCompanyName', 'campaignIndustry', 'campaignRegion',
      'campaignOwnerTeam', 'campaignReleaseWindow', 'campaignAudience', 'campaignEnvironment',
    ]),
    queryRows(graph, draftIdentityQuery, { campaignId }, ['draftId', 'draftCount']),
    queryRows(graph, draftQuery, { campaignId }, [
      'draftId', 'draftTitle', 'draftKind', 'draftText', 'draftStatus', 'promiseId', 'promiseText', 'promiseReviewed',
      'featureId', 'featureName', 'audienceId', 'audienceName', 'reusedDraftId', 'reusedDraftTitle',
      'hasDirectPromise', 'hasReusedPromise', 'sortPosition', 'draftRevision', 'factRevision',
    ]),
  ]);
  const campaignRow = campaignRows[0];
  if (!campaignRow) throw new Error('Campaign not found in FalkorDB.');

  if (draftIdentityRows.length > MAX_CAMPAIGN_DRAFTS) {
    throw new CampaignLimitError(`This campaign has more than ${MAX_CAMPAIGN_DRAFTS} drafts. Split it into smaller campaigns before checking.`);
  }
  if (draftIdentityRows.some((row) => !asString(row[0]).trim() || asNumber(row[1]) > 1)) {
    throw new CampaignDataIntegrityError();
  }
  if (draftRows.length > MAX_CAMPAIGN_PROMISE_PATHS) {
    throw new CampaignLimitError(`This campaign has more than ${MAX_CAMPAIGN_PROMISE_PATHS} promise paths. Resolve duplicate links before checking.`);
  }

  const campaign = {
    id: asString(campaignRow[0]),
    name: asString(campaignRow[1]),
    companyName: asString(campaignRow[2]),
    industry: asString(campaignRow[3]),
    region: asString(campaignRow[4]),
    ownerTeam: asString(campaignRow[5]),
    releaseWindow: asString(campaignRow[6]),
    audience: asString(campaignRow[7]),
    environment: asString(campaignRow[8]),
  };

  const featureIds = [...new Set(draftRows.map((row) => asString(row[8])).filter(Boolean))];
  if (featureIds.length > MAX_CAMPAIGN_FEATURES) {
    throw new CampaignLimitError(`This campaign references more than ${MAX_CAMPAIGN_FEATURES} features. Split it into smaller campaigns before checking.`);
  }
  const factEntries: Array<readonly [string, FeatureFacts]> = [];
  for (let index = 0; index < featureIds.length; index += FEATURE_FACT_QUERY_CONCURRENCY) {
    const batch = featureIds.slice(index, index + FEATURE_FACT_QUERY_CONCURRENCY);
    factEntries.push(...await Promise.all(batch.map(async (id) => [id, await getFeatureFacts(graph, id)] as const)));
  }
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
    const hasDirectPromise = asBoolean(row[14]);
    const hasReusedPromise = asBoolean(row[15]);
    const hasPromise = hasDirectPromise || hasReusedPromise;

    if (!hasPromise) {
      return {
        draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
        promiseText: null, wordingSourceTitle: null, featureName: null, audienceName: null, status: 'Not checked',
        reason: 'No reviewed product promise is linked to this draft.', evidence: [], needsReview: false,
      };
    }

    if (hasDirectPromise && hasReusedPromise) {
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

    if (!promiseId.trim() || !asString(row[6]).trim()) {
      return {
        draftId, title: asString(row[1]), kind: asString(row[2]), text: asString(row[3]),
        promiseText: asString(row[6]) || null, wordingSourceTitle: asString(row[13]) || null,
        featureName: asString(row[9]) || null, audienceName: audienceName || null, status: 'Unknown',
        reason: 'The linked promise is missing its stable ID or claim text.', evidence: [], needsReview: true,
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

  for (const finding of findings) {
    const row = rowsByDraft.get(finding.draftId)?.[0];
    if (!row) continue;
    const featureId = asString(row[8]);
    const draftRevision = asNumber(row[17]);
    const factRevision = asNumber(row[18]);
    finding.draftState = asString(row[4]);
    finding.draftRevision = draftRevision;
    finding.factRevision = factRevision;
    finding.featureId = featureId || null;
    finding.audienceId = asString(row[10]) || null;
    finding.basisFingerprint = fingerprintFinding(
      finding,
      row,
      featureId ? factsByFeature.get(featureId) : undefined,
      campaign.environment,
      draftRevision,
      factRevision,
    );
  }

  const proactiveItems = findings
    .filter((finding) => finding.needsReview)
    .map((finding) => ({
      id: finding.draftId,
      title: `${finding.title} needs review`,
      detail: finding.reason,
      status: finding.status as 'Contradicted' | 'Unknown',
    }));

  const latestDraftRows = await queryRows(graph, draftQuery, { campaignId }, [
    'draftId', 'draftTitle', 'draftKind', 'draftText', 'draftStatus', 'promiseId', 'promiseText', 'promiseReviewed',
    'featureId', 'featureName', 'audienceId', 'audienceName', 'reusedDraftId', 'reusedDraftTitle',
    'hasDirectPromise', 'hasReusedPromise', 'sortPosition', 'draftRevision', 'factRevision',
  ]);
  if (draftSnapshot(latestDraftRows) !== draftSnapshot(draftRows)) {
    throw new CampaignChangedDuringCheckError();
  }

  return { campaign, checkedAt: checkedAt.toISOString(), findings, proactiveItems };
}

export async function checkCampaign(graph: Graph, campaignId: string, checkedAt = new Date()): Promise<CampaignReview> {
  if (activeCampaignChecks >= MAX_CONCURRENT_CAMPAIGN_CHECKS) throw new CampaignCheckCapacityError();
  activeCampaignChecks += 1;
  try {
    return await runCampaignCheck(graph, campaignId, checkedAt);
  } finally {
    activeCampaignChecks -= 1;
  }
}

export interface CampaignAudienceAssessment {
  audienceId: string;
  audienceName: string;
  status: DraftFinding['status'];
  reason: string;
  evidence: EvidenceItem[];
}

export async function assessDraftForAudience(
  graph: Graph,
  review: CampaignReview,
  finding: DraftFinding,
  audienceId: string,
  checkedAt = new Date(review.checkedAt),
): Promise<CampaignAudienceAssessment> {
  if (!finding.featureId || !finding.promiseText) {
    return { audienceId, audienceName: '', status: 'Unknown', reason: 'This draft has no reviewed feature promise to assess.', evidence: [] };
  }

  const audienceRows = await queryRows(graph, campaignAudienceQuery, {
    campaignId: review.campaign.id,
    featureId: finding.featureId,
    audienceId,
  }, ['audienceId', 'audienceName']);
  const audienceRow = audienceRows[0];
  const linkedAudienceId = asString(audienceRow?.[0]);
  const audienceName = asString(audienceRow?.[1]);
  if (linkedAudienceId !== audienceId || !audienceName.trim()) {
    return {
      audienceId,
      audienceName,
      status: 'Unknown',
      reason: 'This audience is not linked to a reviewed promise for the campaign feature.',
      evidence: [],
    };
  }

  const facts = await getFeatureFacts(graph, finding.featureId);
  const result = classifyPromise(
    true,
    audienceId,
    audienceName,
    review.campaign.environment,
    facts,
    checkedAt,
  );
  return { audienceId, audienceName, ...result };
}
