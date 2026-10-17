import { randomUUID } from 'node:crypto';
import type { Graph } from 'falkordb';
import { checkCampaign } from '../checks/campaign.js';
import { defaultDemoCompany, demoCompanies, demoCompanyByCampaignId } from '../../shared/demo-companies.js';
import type {
  CampaignReview, KnowledgeNote, KnowledgeSource, MemoryInstruction, WorkspaceChatResponse,
  WorkspaceSnapshot, WriterDraft,
} from '../../shared/contracts.js';

function companyFor(campaignId: string) {
  const company = demoCompanyByCampaignId(campaignId);
  if (!company) throw new WorkspaceError(404, 'This demo company is not available.');
  return company;
}

type Row = Record<string, unknown>;

export class WorkspaceError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

function rows(result: { data?: unknown[] }, columns: string[]): Row[] {
  return (result.data ?? []).map((value) => Array.isArray(value)
    ? Object.fromEntries(columns.map((column, index) => [column, value[index]]))
    : value as Row);
}

function value(row: Row, key: string): string {
  const item = row[key];
  return typeof item === 'string' ? item : item == null ? '' : String(item);
}

function number(row: Row, key: string): number {
  const item = Number(row[key]);
  return Number.isFinite(item) ? item : 0;
}

function required<T>(item: T | undefined, message: string): T {
  if (!item) throw new WorkspaceError(503, message);
  return item;
}

export async function loadWorkspace(graph: Graph, ownerUnavailable = false, campaignId: string = defaultDemoCompany.campaignId): Promise<WorkspaceSnapshot> {
  const companyConfig = companyFor(campaignId);
  const { companyId, projectId, processId, controlProcessId, handoffId, featureId, baselineRolloutId } = companyConfig;
  const companyRows = rows(await graph.query<unknown[]>(`
MATCH (company:Company {id: $companyId})-[:HAS_PROJECT]->(project:Project {id: $projectId})
RETURN company.id AS companyId, company.name AS companyName, company.shortName AS shortName,
       company.description AS description, project.id AS projectId, project.name AS projectName,
       project.summary AS projectSummary`, { params: { companyId, projectId } }),
  ['companyId', 'companyName', 'shortName', 'description', 'projectId', 'projectName', 'projectSummary']);
  const root = required(companyRows[0], 'The connected workspace fixture is not ready.');

  const noteRows = rows(await graph.query<unknown[]>(`
MATCH (note:KnowledgeNote)-[:ABOUT_PROJECT]->(:Project {id: $projectId})
RETURN note.id AS id, note.title AS title, note.category AS category,
       note.summary AS summary, note.body AS body, note.reviewedBy AS reviewedBy,
       note.reviewedAt AS reviewedAt
ORDER BY category, title`, { params: { projectId } }),
  ['id', 'title', 'category', 'summary', 'body', 'reviewedBy', 'reviewedAt']);
  const notes: KnowledgeNote[] = noteRows.map((row) => ({
    id: value(row, 'id'), title: value(row, 'title'), category: value(row, 'category'),
    summary: value(row, 'summary'), body: value(row, 'body'),
    reviewedBy: value(row, 'reviewedBy'), reviewedAt: value(row, 'reviewedAt'),
    links: [], backlinks: [], sources: [],
  }));
  const byId = new Map(notes.map((note) => [note.id, note]));
  const linkRows = rows(await graph.query<unknown[]>(`
MATCH (a:KnowledgeNote)-[:ABOUT_PROJECT]->(project:Project {id: $projectId})
MATCH (a)-[:LINKS_TO]->(b:KnowledgeNote)-[:ABOUT_PROJECT]->(project)
RETURN a.id AS fromId, b.id AS toId`, { params: { projectId } }), ['fromId', 'toId']);
  for (const row of linkRows) {
    const from = byId.get(value(row, 'fromId'));
    const to = byId.get(value(row, 'toId'));
    if (from && to) { from.links.push(to.id); to.backlinks.push(from.id); }
  }
  const sourceRows = rows(await graph.query<unknown[]>(`
MATCH (note:KnowledgeNote)-[:ABOUT_PROJECT]->(:Project {id: $projectId})
MATCH (note)-[:CITES_SOURCE]->(source:Source)
RETURN note.id AS noteId, source.id AS id, source.label AS label, source.text AS detail`,
  { params: { projectId } }), ['noteId', 'id', 'label', 'detail']);
  for (const row of sourceRows) byId.get(value(row, 'noteId'))?.sources.push({
    id: value(row, 'id'), label: value(row, 'label'), detail: value(row, 'detail'),
  });
  const decisionRows = rows(await graph.query<unknown[]>(`
MATCH (note:KnowledgeNote)-[:ABOUT_PROJECT]->(:Project {id: $projectId})
MATCH (note)-[:CITES_DECISION]->(decision:Decision)
RETURN note.id AS noteId, decision.id AS id, decision.title AS label, decision.body AS detail`,
  { params: { projectId } }), ['noteId', 'id', 'label', 'detail']);
  for (const row of decisionRows) byId.get(value(row, 'noteId'))?.sources.push({
    id: value(row, 'id'), label: value(row, 'label'), detail: value(row, 'detail'),
  });

  const campaignRows = rows(await graph.query<unknown[]>(`
MATCH (campaign:Campaign {id: $campaignId}) RETURN campaign.briefRevision AS briefRevision,
       campaign.demoResetAt AS demoResetAt`,
  { params: { campaignId } }), ['briefRevision', 'demoResetAt']);
  const campaign = required(campaignRows[0], 'The campaign memory is not ready.');
  const instructionRows = rows(await graph.query<unknown[]>(`
MATCH (:Campaign {id: $campaignId})-[:HAS_INSTRUCTION]->(instruction:InstructionVersion)
RETURN instruction.id AS id, instruction.topic AS topic, instruction.text AS text,
       instruction.status AS status, instruction.revision AS revision, instruction.approvedBy AS approvedBy
ORDER BY topic, revision`, { params: { campaignId } }),
  ['id', 'topic', 'text', 'status', 'revision', 'approvedBy']);
  const instructions: MemoryInstruction[] = instructionRows.map((row) => ({
    id: value(row, 'id'), topic: value(row, 'topic'), text: value(row, 'text'),
    status: value(row, 'status') as MemoryInstruction['status'],
    revision: number(row, 'revision'), approvedBy: value(row, 'approvedBy'),
  }));
  const handoffRows = rows(await graph.query<unknown[]>(`
MATCH (handoff:Handoff {id: $handoffId})-[:FOR_TASK]->(:Task)-[:FOR_CAMPAIGN]->(:Campaign {id: $campaignId})
RETURN handoff.id AS id, handoff.summary AS summary, handoff.revision AS revision,
       handoff.fromRole AS fromRole, handoff.toRole AS toRole`,
  { params: { handoffId, campaignId } }),
  ['id', 'summary', 'revision', 'fromRole', 'toRole']);
  const handoff = required(handoffRows[0], 'The planner handoff is not ready.');
  const includedRows = rows(await graph.query<unknown[]>(`
MATCH (:Handoff {id: $handoffId})-[:INCLUDES_INSTRUCTION]->(instruction:InstructionVersion)
RETURN instruction.id AS id`, { params: { handoffId } }), ['id']);
  const episodeRows = rows(await graph.query<unknown[]>(`
MATCH (:Campaign {id: $campaignId})-[:RECORDED_EPISODE]->(episode:ReviewEpisode)
RETURN episode.id AS id, episode.summary AS summary, episode.reviewedBy AS reviewedBy`,
  { params: { campaignId } }), ['id', 'summary', 'reviewedBy']);
  const episode = required(episodeRows[0], 'The reviewed writer feedback is not ready.');
  const draftRows = rows(await graph.query<unknown[]>(`
MATCH (draft:WriterDraft {campaignId: $campaignId})
MATCH (campaign:Campaign {id: $campaignId})
WHERE draft.createdAt >= coalesce(campaign.demoResetAt, '')
RETURN draft.id AS id, draft.title AS title, draft.text AS text, draft.status AS status,
       draft.tone AS tone, draft.briefRevision AS briefRevision,
       draft.factRevision AS factRevision, draft.availabilityBasis AS availabilityBasis,
       draft.createdAt AS createdAt, draft.memoryIds AS memoryIds
ORDER BY createdAt DESC LIMIT 8`, { params: { campaignId } }),
  ['id', 'title', 'text', 'status', 'tone', 'briefRevision', 'factRevision', 'availabilityBasis', 'createdAt', 'memoryIds']);
  const drafts: WriterDraft[] = draftRows.map((row) => ({
    id: value(row, 'id'), title: value(row, 'title'), text: value(row, 'text'),
    status: value(row, 'status') as WriterDraft['status'], tone: value(row, 'tone'), briefRevision: number(row, 'briefRevision'),
    factRevision: number(row, 'factRevision'), availabilityBasis: value(row, 'availabilityBasis'),
    createdAt: value(row, 'createdAt'), memoryIds: Array.isArray(row.memoryIds) ? row.memoryIds.filter((id): id is string => typeof id === 'string') : [],
  }));
  const sessionRows = rows(await graph.query<unknown[]>(`
MATCH (session:AgentSession {campaignId: $campaignId})
MATCH (campaign:Campaign {id: $campaignId})
WHERE session.createdAt >= coalesce(campaign.demoResetAt, '')
RETURN session.createdAt AS createdAt ORDER BY createdAt DESC LIMIT 1`,
  { params: { campaignId } }), ['createdAt']);

  const processRows = rows(await graph.query<unknown[]>(`
MATCH (project:Project {id: $projectId})-[:HAS_PROCESS]->(process:Process {id: $processId})
MATCH (process)-[:PRIMARY_OWNER]->(primary:Person)
MATCH (process)-[:USES_GUIDE]->(guide:KnowledgeNote)-[:CITES_DECISION]->(decision:Decision)
MATCH (process)-[:FOLLOWS_DECISION]->(decision)
OPTIONAL MATCH (process)-[:BACKUP_OWNER]->(backup:Person)
RETURN process.id AS id, process.name AS name, process.summary AS summary,
       process.rosterReviewed AS rosterReviewed, primary.name AS primaryName,
       backup.name AS backupName, guide.id AS guideId, guide.reviewedAt AS guideReviewedAt,
       decision.title AS decisionTitle, decision.reviewedAt AS decisionReviewedAt,
       project.name AS projectName`, { params: { projectId, processId } }),
  ['id', 'name', 'summary', 'rosterReviewed', 'primaryName', 'backupName', 'guideId', 'guideReviewedAt', 'decisionTitle', 'decisionReviewedAt', 'projectName']);
  const process = required(processRows[0], 'The company ownership graph is not ready.');
  const backupRows = rows(await graph.query<unknown[]>(`
MATCH (proposal:BackupProposal {processId: $processId, status: 'pending'})
MATCH (campaign:Campaign {id: $campaignId})
WHERE proposal.createdAt >= coalesce(campaign.demoResetAt, '')
RETURN proposal.id AS id LIMIT 1`, { params: { processId, campaignId } }), ['id']);
  const controlRows = rows(await graph.query<unknown[]>(`
MATCH (process:Process {id: $processId})-[:PRIMARY_OWNER]->(primary:Person)
MATCH (process)-[:BACKUP_OWNER]->(backup:Person)
RETURN process.name AS name, backup.name AS backupName LIMIT 1`,
  { params: { processId: controlProcessId } }), ['name', 'backupName']);
  const control = required(controlRows[0], 'The unaffected process is not ready.');
  const rolloutRows = rows(await graph.query<unknown[]>(`
MATCH (feature:Feature {id: $featureId})-[:HAS_ROLLOUT]->(rollout:Rollout {current: true})
RETURN rollout.id AS id, feature.factsRevision AS factRevision`, { params: { featureId } }), ['id', 'factRevision']);
  const backupName = value(process, 'backupName') || null;
  const rosterReviewed = process.rosterReviewed === true;
  const guideCurrent = rolloutRows.length === 1 && value(rolloutRows[0], 'id') === baselineRolloutId
    && Boolean(value(process, 'guideReviewedAt'))
    && new Date(value(process, 'guideReviewedAt')).getTime() >= new Date(value(process, 'decisionReviewedAt')).getTime();
  const coverage: WorkspaceSnapshot['companyBrain']['coverage'] = !rosterReviewed
    ? 'Unknown'
    : ownerUnavailable ? (backupName ? 'Covered by backup' : 'Uncovered in this scenario')
      : backupName ? 'Covered by primary' : 'Needs backup confirmation';
  const eventRows = rows(await graph.query<unknown[]>(`
MATCH (event:WorkspaceEvent {projectId: $projectId})
MATCH (campaign:Campaign {id: $campaignId})
WHERE event.occurredAt >= coalesce(campaign.demoResetAt, '')
RETURN event.id AS id, event.kind AS kind, event.title AS title,
       event.detail AS detail, event.occurredAt AS occurredAt
ORDER BY occurredAt DESC LIMIT 12`, { params: { projectId, campaignId } }),
  ['id', 'kind', 'title', 'detail', 'occurredAt']);

  return {
    company: { id: value(root, 'companyId'), name: value(root, 'companyName'), shortName: value(root, 'shortName'), description: value(root, 'description') },
    project: { id: value(root, 'projectId'), name: value(root, 'projectName'), summary: value(root, 'projectSummary') },
    notes,
    memory: {
      briefRevision: number(campaign, 'briefRevision'), currentFactRevision: number(rolloutRows[0] ?? {}, 'factRevision'), instructions,
      handoff: { id: value(handoff, 'id'), summary: value(handoff, 'summary'), revision: number(handoff, 'revision'),
        fromRole: value(handoff, 'fromRole'), toRole: value(handoff, 'toRole'),
        includedInstructionIds: includedRows.map((row) => value(row, 'id')) },
      episode: { id: value(episode, 'id'), summary: value(episode, 'summary'), reviewedBy: value(episode, 'reviewedBy') },
      drafts, lastSessionAt: sessionRows[0] ? value(sessionRows[0], 'createdAt') : null,
    },
    companyBrain: {
      processId: value(process, 'id'), processName: value(process, 'name'), processSummary: value(process, 'summary'),
      primaryName: value(process, 'primaryName'), backupName,
      backupProposalStatus: backupRows.length ? 'pending' : null, rosterReviewed, coverage,
      guideNoteId: value(process, 'guideId'), guideCurrent,
      decisionTitle: value(process, 'decisionTitle'), affectedProject: value(process, 'projectName'),
      controlProcess: { name: value(control, 'name'), coverage: `Covered by ${value(control, 'backupName')} when its primary is unavailable` },
      ownerUnavailable,
    },
    events: eventRows.map((row) => ({ id: value(row, 'id'), kind: value(row, 'kind'), title: value(row, 'title'),
      detail: value(row, 'detail'), occurredAt: value(row, 'occurredAt') })),
  };
}

function changed(result: { data?: unknown[] }, message: string): void {
  if (!result.data?.length) throw new WorkspaceError(409, message);
}

export async function approveTone(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  const now = new Date().toISOString();
  changed(await graph.query<unknown[]>(`
MATCH (campaign:Campaign {id: $campaignId})-[:HAS_INSTRUCTION]->(old:InstructionVersion {id: $oldToneId, status: 'approved'})
MATCH (campaign)-[:HAS_INSTRUCTION]->(next:InstructionVersion {id: $proposedToneId, status: 'pending'})
WHERE campaign.briefRevision = 1
SET old.status = 'superseded', next.status = 'approved', next.approvedBy = $reviewerName, next.approvedAt = $now,
    campaign.briefRevision = 2
MERGE (next)-[:SUPERSEDES]->(old)
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: 'instruction.approved',
  title: 'Campaign tone approved', detail: $detail, occurredAt: $now})
RETURN next.id AS id`, { params: { campaignId, projectId: company.projectId, oldToneId: company.oldToneId,
    proposedToneId: company.proposedToneId, reviewerName: company.reviewerName, now, eventId: randomUUID(),
    detail: `The proposed tone replaced the earlier instruction for ${company.shortName}.` } }),
  'The tone change was already applied or the brief changed. Refresh the workspace.');
}

export async function runWriterSession(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  const [snapshot, review] = await Promise.all([loadWorkspace(graph, false, campaignId), checkCampaign(graph, campaignId)]);
  const active = snapshot.memory.instructions.filter((instruction) => instruction.status === 'approved');
  const tones = active.filter((instruction) => instruction.topic === 'tone');
  const openings = active.filter((instruction) => instruction.topic === 'opening');
  if (tones.length !== 1 || openings.length !== 1) {
    throw new WorkspaceError(409, 'The current brief is missing or conflicts. A reviewer must resolve it before the writer continues.');
  }
  const tone = tones[0];
  const opening = openings[0];
  const calm = tone.id === company.proposedToneId;
  const allAccountFindings = review.findings.filter((finding) => finding.audienceId === company.broadAudienceId);
  const testerFinding = review.findings.find((finding) => finding.audienceId === company.limitedAudienceId);
  const factRevision = review.findings.find((finding) => finding.factRevision)?.factRevision ?? 0;
  if (!factRevision || !allAccountFindings.length) throw new WorkspaceError(409, 'Current campaign evidence is not ready for a new draft.');
  const allAccountsSupported = allAccountFindings.every((finding) => finding.status === 'Supported');
  const testerSupported = testerFinding?.status === 'Supported';
  const availabilityBasis = allAccountsSupported ? 'Broad access is supported by the current campaign check.'
    : testerSupported ? 'Limited access is supported by the current campaign check.'
      : 'The current campaign check does not support an availability claim.';
  const availabilityLine = allAccountsSupported
    ? company.broadAvailability
    : testerSupported
      ? company.limitedAvailability
      : company.unknownAvailability;
  const text = `${calm ? company.writerOpening : company.writerBridge} ${calm ? company.writerBridge : ''} ${availabilityLine}`.replace(/\s+/g, ' ').trim();
  const now = new Date().toISOString();
  const draftId = randomUUID();
  changed(await graph.query<unknown[]>(`
MATCH (campaign:Campaign {id: $campaignId})-[:HAS_INSTRUCTION]->(tone:InstructionVersion {id: $toneId, status: 'approved'})
MATCH (campaign)-[:HAS_INSTRUCTION]->(opening:InstructionVersion {id: $openingId, status: 'approved'})
MATCH (feature:Feature {id: $featureId})
MATCH (handoff:Handoff {id: $handoffId})-[:FOR_TASK]->(task:Task)-[:FOR_CAMPAIGN]->(campaign)
MATCH (campaign)-[:RECORDED_EPISODE]->(episode:ReviewEpisode {id: $episodeId})
WHERE campaign.briefRevision = $briefRevision AND feature.factsRevision = $factRevision
CREATE (session:AgentSession {id: $sessionId, campaignId: $campaignId, role: 'Writing agent',
  handoffRevision: handoff.revision, briefRevision: $briefRevision, status: 'drafted', createdAt: $now})
CREATE (draft:WriterDraft {id: $draftId, campaignId: $campaignId, title: 'Fresh-session launch email',
  text: $text, status: 'pending_approval', tone: $toneText, briefRevision: $briefRevision,
  factRevision: $factRevision, availabilityBasis: $availabilityBasis,
  memoryIds: $memoryIds, createdAt: $now})
CREATE (session)-[:REFRESHED_FROM]->(handoff)
CREATE (session)-[:USED_INSTRUCTION]->(tone)
CREATE (session)-[:USED_INSTRUCTION]->(opening)
CREATE (session)-[:USED_EPISODE]->(episode)
CREATE (session)-[:PRODUCED]->(draft)
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: 'writer.drafted',
  title: 'Fresh writer session prepared a draft', detail: $eventDetail, occurredAt: $now})
RETURN draft.id AS id`, { params: {
    campaignId, projectId: company.projectId, featureId: company.featureId, toneId: tone.id, openingId: opening.id, handoffId: snapshot.memory.handoff.id,
    episodeId: snapshot.memory.episode.id, briefRevision: snapshot.memory.briefRevision, factRevision,
    sessionId: randomUUID(), draftId, text, toneText: tone.text, availabilityBasis,
    memoryIds: [tone.id, opening.id, snapshot.memory.episode.id], now,
    eventId: randomUUID(), eventDetail: `Used brief revision ${snapshot.memory.briefRevision}; the original handoff was revision ${snapshot.memory.handoff.revision}.`,
  } }), 'The brief or rollout evidence changed while the writer was preparing. Refresh and start a new session.');
}

export async function reviewWriterDraft(graph: Graph, draftId: string, decision: 'approve' | 'reject', campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) throw new WorkspaceError(400, 'Choose a valid writer draft.');
  const now = new Date().toISOString();
  const status = decision === 'approve' ? 'approved_internal' : 'rejected';
  const title = decision === 'approve' ? 'Writer draft approved internally' : 'Writer draft rejected';
  changed(await graph.query<unknown[]>(`
MATCH (draft:WriterDraft {id: $draftId, campaignId: $campaignId, status: 'pending_approval'})
MATCH (campaign:Campaign {id: $campaignId})
MATCH (feature:Feature {id: $featureId})
WHERE draft.createdAt >= coalesce(campaign.demoResetAt, '')
  AND ($reject = true OR (campaign.briefRevision = draft.briefRevision AND feature.factsRevision = draft.factRevision))
SET draft.status = $status, draft.reviewedAt = $now, draft.reviewedBy = $reviewerName
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: $kind,
  title: $title, detail: $detail, occurredAt: $now})
RETURN draft.id AS id`, { params: {
    draftId, campaignId, projectId: company.projectId, featureId: company.featureId, reviewerName: company.reviewerName,
    status, now, eventId: randomUUID(), reject: decision === 'reject',
    kind: decision === 'approve' ? 'writer.approved' : 'writer.rejected', title,
    detail: decision === 'approve' ? 'Approved for internal use only. Nothing was sent or published.' : 'The draft remains in history for review.',
  } }), 'The draft was already reviewed or its brief or rollout evidence changed. Refresh before deciding.');
}

export async function proposeBackup(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  const now = new Date().toISOString();
  changed(await graph.query<unknown[]>(`
MATCH (process:Process {id: $processId})
MATCH (campaign:Campaign {id: $campaignId})
OPTIONAL MATCH (process)-[:BACKUP_OWNER]->(backup:Person)
OPTIONAL MATCH (pending:BackupProposal {processId: $processId, status: 'pending'})
WHERE pending.createdAt >= coalesce(campaign.demoResetAt, '')
WITH process, count(DISTINCT backup) AS backupCount, count(DISTINCT pending) AS pendingCount
WHERE backupCount = 0 AND pendingCount = 0 AND process.rosterReviewed = true
CREATE (proposal:BackupProposal {id: $proposalId, processId: $processId, personId: $personId,
  status: 'pending', basedOnRevision: process.revision, reason: $reason, createdAt: $now})
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: 'backup.proposed',
  title: 'Backup assignment proposed', detail: $detail, occurredAt: $now})
RETURN proposal.id AS id`, { params: {
    processId: company.processId, personId: company.backupId, proposalId: randomUUID(), projectId: company.projectId,
    campaignId, now, eventId: randomUUID(), reason: `${company.backupName} can cover ${company.shortName}'s evidence review in this demo.`,
    detail: `${company.backupName} is proposed as backup; coverage is unchanged.`,
  } }), 'A backup is already confirmed or a proposal is waiting for review.');
}

export async function approveBackup(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  const now = new Date().toISOString();
  changed(await graph.query<unknown[]>(`
MATCH (process:Process {id: $processId})
MATCH (proposal:BackupProposal {processId: $processId, personId: $personId, status: 'pending'})
MATCH (campaign:Campaign {id: $campaignId})
MATCH (person:Person {id: $personId})
WHERE proposal.createdAt >= coalesce(campaign.demoResetAt, '')
  AND process.revision = proposal.basedOnRevision AND NOT (process)-[:BACKUP_OWNER]->()
SET proposal.status = 'approved', proposal.approvedAt = $now, proposal.approvedBy = $reviewerName,
    process.revision = process.revision + 1
MERGE (process)-[:BACKUP_OWNER]->(person)
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: 'backup.approved',
  title: 'Backup assignment approved', detail: $detail, occurredAt: $now})
RETURN person.id AS id`, { params: {
    processId: company.processId, personId: company.backupId, projectId: company.projectId,
    campaignId, now, eventId: randomUUID(), reviewerName: company.reviewerName,
    detail: `${company.backupName} is now the reviewed backup for ${company.shortName}'s evidence review.`,
  } }), 'The backup proposal is missing or the process changed. Refresh before approving.');
}

export async function resetWorkspaceDemo(graph: Graph, campaignId: string = defaultDemoCompany.campaignId): Promise<void> {
  const company = companyFor(campaignId);
  const now = new Date().toISOString();
  changed(await graph.query<unknown[]>(`
MATCH (campaign:Campaign {id: $campaignId})-[:HAS_INSTRUCTION]->(old:InstructionVersion {id: $oldToneId})
MATCH (campaign)-[:HAS_INSTRUCTION]->(next:InstructionVersion {id: $proposedToneId})
MATCH (process:Process {id: $processId})
OPTIONAL MATCH (process)-[backup:BACKUP_OWNER]->(:Person)
WITH campaign, old, next, process, collect(backup) AS backupLinks
OPTIONAL MATCH (campaign)-[:HAS_PROPOSAL]->(pending:ActionProposal {status: 'pending'})
WITH campaign, old, next, process, backupLinks, collect(pending) AS pendingProposals
FOREACH (link IN backupLinks | DELETE link)
FOREACH (proposal IN pendingProposals | SET proposal.status = 'needs_recheck', proposal.updatedAt = $now)
SET old.status = 'approved', next.status = 'pending', next.approvedBy = '', next.approvedAt = '',
    campaign.briefRevision = 1, campaign.demoResetAt = $now,
    process.revision = coalesce(process.revision, 1) + 1
CREATE (event:WorkspaceEvent {id: $eventId, projectId: $projectId, kind: 'demo.reset',
  title: 'Fictional demo reset', detail: 'Tone and launch backup returned to their baseline. Earlier records remain in graph history.', occurredAt: $now})
RETURN campaign.id AS id`, { params: {
    campaignId, processId: company.processId, projectId: company.projectId, oldToneId: company.oldToneId,
    proposedToneId: company.proposedToneId, now, eventId: randomUUID(),
  } }), 'The fictional demo baseline could not be restored. Refresh the workspace.');
}

export function answerWorkspaceQuestion(message: string, snapshot: WorkspaceSnapshot, review: CampaignReview): WorkspaceChatResponse {
  const company = demoCompanies.find((item) => item.companyId === snapshot.company.id || item.shortName === snapshot.company.shortName)
    ?? demoCompanyByCampaignId(review.campaign?.id) ?? defaultDemoCompany;
  const notes = company.noteIds;
  const question = message.toLowerCase();
  const sources: KnowledgeSource[] = [];
  const cite = (noteId: string) => {
    const note = snapshot.notes.find((item) => item.id === noteId);
    if (note && !sources.some((item) => item.id === note.id)) sources.push({ id: note.id, label: note.title, detail: note.summary });
  };
  let answer: string;
  if (/note|source|decision|document|file|knowledge/.test(question)) {
    const categories = [...new Set(snapshot.notes.map((note) => note.category))];
    const sourced = snapshot.notes.filter((note) => note.sources.length);
    answer = `The Company Brain contains ${snapshot.notes.length} notes across ${categories.join(', ')}. ${sourced.length} have direct source or decision links: ${sourced.map((note) => note.title).join('; ')}. A dated rollout decision is historical; use the live campaign check for current access.`;
    cite(notes.company); cite(notes.decision); cite(notes.guide);
  } else if (/draft|email|copy|post|claim|campaign/.test(question)) {
    const findings = review.findings.map((finding) => `${finding.title}: ${finding.status}${finding.draftState === 'paused' ? ' (paused)' : ''}`).join('; ');
    const pending = snapshot.memory.drafts.filter((draft) => draft.status === 'pending_approval').length;
    answer = `The campaign has ${review.findings.length} linked drafts. ${findings}. The fresh-session writer has prepared ${snapshot.memory.drafts.length} internal draft${snapshot.memory.drafts.length === 1 ? '' : 's'}; ${pending} wait for human review. No draft has been sent or published.`;
    cite(notes.campaign); cite(notes.decision);
  } else if (/memory|handoff|writer|tone|brief|agent/.test(question)) {
    const active = snapshot.memory.instructions.filter((item) => item.status === 'approved');
    answer = `The planner handoff saved brief revision ${snapshot.memory.handoff.revision}; the current approved brief is revision ${snapshot.memory.briefRevision}. Active instructions: ${active.map((item) => `${item.topic}: ${item.text}`).join(' ')} The reviewed opening feedback says: ${snapshot.memory.episode.summary} A fresh writer session checks these records before drafting.`;
    cite(notes.handoff); cite(notes.review);
  } else if (/owner|backup|coverage|handover|process|company|team|who/.test(question)) {
    const brain = snapshot.companyBrain;
    answer = `${brain.processName} is owned by ${brain.primaryName}. ${brain.backupName ? `${brain.backupName} is the reviewed backup.` : brain.backupProposalStatus ? 'A backup proposal is pending and does not count as coverage.' : 'No backup is confirmed in the reviewed roster.'} ${brain.ownerUnavailable ? `With the owner unavailable in this scenario, coverage is ${brain.coverage}.` : `Current coverage is ${brain.coverage}.`} The current guide is linked to ${brain.decisionTitle}; ${brain.affectedProject} depends on this process.`;
    cite(notes.roster); cite(notes.guide); cite(notes.decision);
  } else if (/workflow|status|done|pending|review|activity|happen/.test(question)) {
    const needsReview = review.findings.filter((finding) => finding.needsReview).length;
    const pending = snapshot.memory.drafts.filter((draft) => draft.status === 'pending_approval').length;
    answer = `${needsReview} campaign finding${needsReview === 1 ? '' : 's'} need review. ${pending} fresh writer draft${pending === 1 ? '' : 's'} wait for a person. ${snapshot.companyBrain.backupProposalStatus ? 'The backup assignment is pending approval.' : snapshot.companyBrain.backupName ? 'The backup assignment is approved.' : 'No backup proposal is pending.'} The latest connected-workspace event is ${snapshot.events[0]?.title ?? 'not recorded yet'}.`;
    cite(notes.guide); cite(notes.handoff);
  } else {
    answer = `I can check the connected records for ${snapshot.company.shortName}. Ask about campaign drafts, the current writer handoff, company notes, launch ownership, or work waiting for review. I will answer from the graph and show the notes used.`;
    cite(notes.company);
  }
  return { answer, sources, checkedAt: new Date().toISOString() };
}
