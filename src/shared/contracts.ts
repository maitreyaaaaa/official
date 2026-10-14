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
    audience: string;
    environment: string;
  };
  checkedAt: string;
  findings: DraftFinding[];
  proactiveItems: ProactiveItem[];
}
