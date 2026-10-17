import type { CampaignReview, DraftFinding, MemoryInstruction, WorkspaceSnapshot } from './contracts.js';

export interface ProofComparison {
  title: string;
  before: string;
  changed: string;
  after: string;
  control: string;
}

function findingFor(review: CampaignReview, audienceId: string): DraftFinding | undefined {
  return review.findings.find((finding) => finding.audienceId === audienceId);
}

export function rolloutProof(before: CampaignReview, after: CampaignReview, broadAudienceId: string, limitedAudienceId: string): ProofComparison | null {
  const oldBroad = findingFor(before, broadAudienceId);
  const newBroad = findingFor(after, broadAudienceId);
  const oldControl = findingFor(before, limitedAudienceId);
  const newControl = findingFor(after, limitedAudienceId);
  if (!oldBroad || !newBroad || !oldControl || !newControl) return null;
  if (!oldBroad.factRevision || !newBroad.factRevision || oldBroad.factRevision === newBroad.factRevision) return null;
  return {
    title: 'Rollout check, before and after',
    before: `${oldBroad.audienceName}: ${oldBroad.status} (fact revision ${oldBroad.factRevision})`,
    changed: `FalkorDB rollout fact revision ${oldBroad.factRevision} → ${newBroad.factRevision}`,
    after: `${newBroad.audienceName}: ${newBroad.status} (fact revision ${newBroad.factRevision})`,
    control: `${newControl.audienceName}: ${oldControl.status} → ${newControl.status}${oldControl.status === newControl.status ? ' (unchanged)' : ''}`,
  };
}

function approvedInstruction(snapshot: WorkspaceSnapshot, topic: string): MemoryInstruction | undefined {
  return snapshot.memory.instructions.find((item) => item.topic === topic && item.status === 'approved');
}

export function savedHandoffInstruction(snapshot: WorkspaceSnapshot, topic: string): MemoryInstruction | undefined {
  return snapshot.memory.instructions.find((item) => item.topic === topic && snapshot.memory.handoff.includedInstructionIds.includes(item.id));
}

export function toneProof(before: WorkspaceSnapshot, after: WorkspaceSnapshot): ProofComparison | null {
  const previous = approvedInstruction(before, 'tone');
  const current = approvedInstruction(after, 'tone');
  const oldOpening = approvedInstruction(before, 'opening');
  const newOpening = approvedInstruction(after, 'opening');
  if (!previous || !current || !oldOpening || !newOpening || previous.id === current.id) return null;
  return {
    title: 'Approved brief, before and after',
    before: `Tone revision ${previous.revision}: ${previous.text}`,
    changed: `FalkorDB approved instruction ${previous.id} → ${current.id}`,
    after: `Tone revision ${current.revision}: ${current.text}`,
    control: `Opening rule: ${oldOpening.id === newOpening.id ? 'unchanged' : 'changed'} (${newOpening.text})`,
  };
}

export function backupProof(before: WorkspaceSnapshot, after: WorkspaceSnapshot): ProofComparison | null {
  const oldBrain = before.companyBrain;
  const newBrain = after.companyBrain;
  if (oldBrain.backupName === newBrain.backupName || !newBrain.backupName) return null;
  return {
    title: 'Coverage with primary unavailable',
    before: `${oldBrain.coverage}; backup ${oldBrain.backupName ?? 'not confirmed'}`,
    changed: `FalkorDB approved backup assignment: ${newBrain.backupName}`,
    after: newBrain.coverage,
    control: `${newBrain.controlProcess.name}: ${before.companyBrain.controlProcess.coverage === newBrain.controlProcess.coverage ? 'unchanged' : 'changed'} (${newBrain.controlProcess.coverage})`,
  };
}

export function unknownReviewStep(reason: string): string {
  const text = reason.toLowerCase();
  if (text.includes('disagree') || text.includes('conflict')) return 'Compare the conflicting current records and resolve the disagreement with a reviewer.';
  if (text.includes('not been reviewed') || text.includes('unreviewed')) return 'Ask a reviewer to verify the named record before relying on this claim.';
  if (text.includes('fresh source')) return 'Link a current source reviewed by a person to the named record.';
  if (text.includes('stable graph id') || text.includes('stable id')) return 'Repair the missing graph ID, then run the check again.';
  if (text.includes('passing') && text.includes('test')) return 'Review a passing test for the running revision, then run the check again.';
  if (text.includes('deployment')) return 'Review the current deployment record for this feature and environment.';
  if (text.includes('rollout') || text.includes('access')) return 'Review the current rollout record for this audience.';
  if (text.includes('feature or audience link')) return 'Link the reviewed promise to a feature and audience, then run the check again.';
  return 'Inspect the linked evidence below and ask a reviewer to resolve the missing or unclear record.';
}
