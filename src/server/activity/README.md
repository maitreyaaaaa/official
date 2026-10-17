# Activity history

`activity.ts` writes a `ReviewRun` with a status-only findings snapshot and a linked `ActivityEvent` after a successful, explicitly requested local campaign check. The synthetic S4 rollout and reversible test-availability scenario actions create their events in the same graph query as their fact updates. `listCampaignActivity` returns the latest 20 events for the campaign.

Events cover checks, the synthetic rollout, test-scenario transitions, proposal creation, approval/execution, rejection, stale proposals, and explicit resume. Reviewer identity, failed-action logging, and retention controls remain future work. The API is local-development-only and guarded by the existing fixture/demo-write configuration.
