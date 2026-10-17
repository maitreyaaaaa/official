import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CampaignReview, WorkspaceSnapshot } from './contracts.js';
import { backupProof, rolloutProof, savedHandoffInstruction, toneProof, unknownReviewStep } from './reviewer-proof.js';

function review(broadStatus: 'Contradicted' | 'Supported', revision: number): CampaignReview {
  return { findings: [
    { audienceId: 'audience-all', audienceName: 'All accounts', status: broadStatus, factRevision: revision },
    { audienceId: 'audience-pilot', audienceName: 'Pilot accounts', status: 'Supported', factRevision: revision },
  ] } as CampaignReview;
}

test('rollout proof requires a changed graph fact and shows an unaffected audience', () => {
  assert.equal(rolloutProof(review('Contradicted', 1), review('Supported', 1), 'audience-all', 'audience-pilot'), null);
  const proof = rolloutProof(review('Contradicted', 1), review('Supported', 2), 'audience-all', 'audience-pilot');
  assert.match(proof?.changed ?? '', /1 → 2/);
  assert.match(proof?.control ?? '', /unchanged/);
});

function snapshot(toneStatus: 'pending' | 'approved', backupName: string | null = null): WorkspaceSnapshot {
  return { memory: { handoff: { includedInstructionIds: ['tone-old', 'opening'] }, instructions: [
    { id: 'tone-old', topic: 'tone', text: 'Earlier tone', status: toneStatus === 'pending' ? 'approved' : 'superseded', revision: 1 },
    { id: 'tone-new', topic: 'tone', text: 'Calmer tone', status: toneStatus, revision: 2 },
    { id: 'opening', topic: 'opening', text: 'Keep the opening', status: 'approved', revision: 1 },
  ] }, companyBrain: { backupName, coverage: backupName ? 'Covered by backup' : 'Uncovered in this scenario',
    controlProcess: { name: 'Billing review', coverage: 'Covered by a separate backup' } } } as WorkspaceSnapshot;
}

test('handoff uses stored IDs and excludes pending tone from current proof', () => {
  const before = snapshot('pending');
  const after = snapshot('approved');
  assert.equal(savedHandoffInstruction(after, 'tone')?.id, 'tone-old');
  assert.equal(toneProof(before, before), null);
  const proof = toneProof(before, after);
  assert.match(proof?.after ?? '', /Calmer tone/);
  assert.match(proof?.control ?? '', /unchanged/);
});

test('backup proof keeps the unaffected process visible', () => {
  const proof = backupProof(snapshot('pending'), snapshot('pending', 'Ren Patel'));
  assert.match(proof?.after ?? '', /Covered by backup/);
  assert.match(proof?.control ?? '', /unchanged/);
});

test('Unknown guidance maps only the check reason to a review step', () => {
  assert.match(unknownReviewStep('Current reviewed rollout records disagree about this audience.'), /conflicting current records/);
  assert.match(unknownReviewStep('No current passing production test is recorded for the running revision.'), /passing test/);
});
