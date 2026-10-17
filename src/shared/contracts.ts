export type FindingStatus = 'Supported' | 'Contradicted' | 'Unknown' | 'Not checked';

export interface EvidenceItem {
  id: string;
  label: string;
  detail: string;
  kind: 'deployment' | 'rollout' | 'test';
  observedAt: string;
  reviewedBy: string;
}

export interface DraftFinding {
  draftId: string;
  draftRevision?: number;
  factRevision?: number;
  basisFingerprint?: string;
  featureId?: string | null;
  audienceId?: string | null;
  draftState?: string;
  title: string;
  kind: string;
  text: string;
  promiseText: string | null;
  wordingSourceTitle: string | null;
  featureName: string | null;
  audienceName: string | null;
  status: FindingStatus;
  reason: string;
  evidence: EvidenceItem[];
  needsReview: boolean;
}

export interface ProactiveItem {
  id: string;
  title: string;
  detail: string;
  status: Exclude<FindingStatus, 'Supported' | 'Not checked'>;
}

export interface CampaignReview {
  campaign: {
    id: string;
    name: string;
    companyName: string;
    industry: string;
    region: string;
    ownerTeam: string;
    releaseWindow: string;
    audience: string;
    environment: string;
  };
  checkedAt: string;
  findings: DraftFinding[];
  proactiveItems: ProactiveItem[];
}

export interface ActivityEntry {
  id: string;
  campaignId: string;
  kind: 'campaign.checked' | 'rollout.expanded' | 'demo.test_scenario.changed' | 'proposal.created' | 'proposal.approved' | 'proposal.executed' | 'proposal.rejected' | 'proposal.needs_recheck' | 'draft.resumed';
  occurredAt: string;
  title: string;
  detail: string;
  runId?: string;
}

export type ProposalAction = 'pause' | 'edit';
export type ProposalStatus = 'pending' | 'executed' | 'rejected' | 'needs_recheck';

export interface ActionProposal {
  id: string;
  campaignId: string;
  draftId: string;
  action: ProposalAction;
  proposedText: string | null;
  targetAudienceId: string;
  reason: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  basedOnRunId: string;
}

export interface AgentToolTrace {
  name: string;
  summary: string;
}

export interface CampaignProposalPreview {
  action: ProposalAction;
  draftId: string;
  draftTitle: string;
  proposedText: string | null;
  targetAudienceId: string;
  reason: string;
}

export interface CampaignAssistantResponse {
  answer: string;
  toolCalls: AgentToolTrace[];
  proposalPreview?: CampaignProposalPreview;
}

export interface KnowledgeSource {
  id: string;
  label: string;
  detail: string;
}

export interface KnowledgeNote {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  reviewedBy: string;
  reviewedAt: string;
  links: string[];
  backlinks: string[];
  sources: KnowledgeSource[];
}

export interface MemoryInstruction {
  id: string;
  topic: string;
  text: string;
  status: 'approved' | 'pending' | 'superseded';
  revision: number;
  approvedBy: string;
}

export interface WriterDraft {
  id: string;
  title: string;
  text: string;
  status: 'pending_approval' | 'approved_internal' | 'rejected';
  tone: string;
  briefRevision: number;
  factRevision: number;
  availabilityBasis: string;
  createdAt: string;
  memoryIds: string[];
}

export interface WorkspaceSnapshot {
  company: { id: string; name: string; shortName: string; description: string };
  project: { id: string; name: string; summary: string };
  notes: KnowledgeNote[];
  memory: {
    briefRevision: number;
    currentFactRevision: number;
    instructions: MemoryInstruction[];
    handoff: { id: string; summary: string; revision: number; fromRole: string; toRole: string; includedInstructionIds: string[] };
    episode: { id: string; summary: string; reviewedBy: string };
    drafts: WriterDraft[];
    lastSessionAt: string | null;
  };
  companyBrain: {
    processId: string;
    processName: string;
    processSummary: string;
    primaryName: string;
    backupName: string | null;
    backupProposalStatus: 'pending' | null;
    rosterReviewed: boolean;
    coverage: 'Covered by primary' | 'Covered by backup' | 'Uncovered in this scenario' | 'Needs backup confirmation' | 'Unknown';
    guideNoteId: string;
    guideCurrent: boolean;
    decisionCurrent: boolean;
    linkedSourceCount: number;
    decisionTitle: string;
    affectedProject: string;
    controlProcess: { name: string; coverage: string };
    ownerUnavailable: boolean;
  };
  events: Array<{ id: string; kind: string; title: string; detail: string; occurredAt: string }>;
}

export interface WorkspaceChatResponse {
  answer: string;
  sources: KnowledgeSource[];
  checkedAt: string;
}
