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
