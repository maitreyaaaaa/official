export const demoCompanies = [
  {
    key: 'alder-finch', shortName: 'Alder & Finch', monogram: 'A&F', logoPath: '/brand/companies/alder-finch.png',
    campaignId: 'campaign-csv-launch', companyId: 'company-alder-finch', projectId: 'project-spring-reporting',
    featureId: 'feature-csv-export', broadAudienceId: 'audience-all-accounts', limitedAudienceId: 'audience-internal-testers',
    baselineRolloutId: 'rollout-testers-only', expandedRolloutId: 'rollout-all-accounts', testId: 'test-csv-r17',
    processId: 'process-launch-evidence', controlProcessId: 'process-release-qa', handoffId: 'handoff-launch-v1',
    oldToneId: 'instruction-playful', proposedToneId: 'instruction-calm', openingId: 'instruction-benefit',
    reviewerName: 'Maya Chen', backupId: 'person-zara', backupName: 'Zara Patel',
    noteIds: { company: 'note-company', decision: 'note-release-decision', guide: 'note-launch-checklist',
      campaign: 'note-campaign-brief', review: 'note-editorial-review', handoff: 'note-handoff', roster: 'note-roster' },
    writerOpening: 'See your weekly work in one clear view.',
    writerBridge: 'The spring reporting update brings your key activity together.',
    limitedAvailability: 'Internal testers can use CSV export today; we will share broader access when it is reviewed.',
    broadAvailability: 'CSV export is available to every account.',
    unknownAvailability: 'We are reviewing CSV export availability and will share access details after the evidence is confirmed.',
  },
  {
    key: 'northstar', shortName: 'Northstar Parcel', monogram: 'NP', logoPath: '/brand/companies/northstar-parcel.png',
    campaignId: 'campaign-route-timeline', companyId: 'company-northstar-parcel', projectId: 'project-delivery-timeline',
    featureId: 'feature-live-timeline', broadAudienceId: 'audience-all-merchants', limitedAudienceId: 'audience-pilot-merchants',
    baselineRolloutId: 'rollout-pilot-merchants', expandedRolloutId: 'rollout-all-merchants', testId: 'test-timeline-n24',
    processId: 'process-timeline-evidence', controlProcessId: 'process-delivery-qa', handoffId: 'handoff-timeline-v1',
    oldToneId: 'instruction-northstar-brisk', proposedToneId: 'instruction-northstar-assured', openingId: 'instruction-northstar-benefit',
    reviewerName: 'Iris Malik', backupId: 'person-northstar-nolan', backupName: 'Nolan Price',
    noteIds: { company: 'note-northstar-company', decision: 'note-northstar-rollout', guide: 'note-northstar-checklist',
      campaign: 'note-northstar-brief', review: 'note-northstar-review', handoff: 'note-northstar-handoff', roster: 'note-northstar-roster' },
    writerOpening: 'Know where every delivery stands without chasing updates.',
    writerBridge: 'The delivery timeline brings carrier scans and ETA changes into one view.',
    limitedAvailability: 'Pilot merchants can share live delivery timelines today; broader access is still under review.',
    broadAvailability: 'Every merchant can share a live delivery timeline today.',
    unknownAvailability: 'We are checking timeline availability and will confirm access after the release evidence is reviewed.',
  },
] as const;

export type DemoCompany = (typeof demoCompanies)[number];
export type DemoCompanyKey = DemoCompany['key'];
export const defaultDemoCompany = demoCompanies[0];

export function demoCompanyByKey(key: string | null | undefined): DemoCompany | undefined {
  return demoCompanies.find((company) => company.key === key);
}

export function demoCompanyByCampaignId(campaignId: string | null | undefined): DemoCompany | undefined {
  return demoCompanies.find((company) => company.campaignId === campaignId);
}
