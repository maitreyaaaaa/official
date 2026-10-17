# Graph model and queries

FalkorDB stores the campaign facts used by the checker. The client never connects to FalkorDB directly. The server issues fixed, parameterized Cypher queries, and the checker returns source IDs and explanations with each finding.

## Labels and relationships

| Start | Relationship | End | Purpose |
| --- | --- | --- | --- |
| `Draft` | `IN_CAMPAIGN` | `Campaign` | Select drafts in a campaign |
| `Draft` | `MAKES_PROMISE` | `Promise` | Link direct draft wording to a promise |
| `Draft` | `REUSES_DRAFT` | `Draft` | Reuse a source draft's promise |
| `Promise` | `ABOUT` | `Feature` | Identify the promised product feature |
| `Promise` | `TARGETS` | `Audience` | Identify the promise audience |
| `Feature` | `RUNNING_AS` | `Deployment` | Record current feature presence and revision |
| `Feature` | `HAS_ROLLOUT` | `Rollout` | Record current audience inclusion or exclusion |
| `Feature` | `HAS_TEST` | `Test` | Record a current test against a revision |
| `Rollout` | `INCLUDES` / `EXCLUDES` | `Audience` | Record rollout audience membership |
| `Deployment`, `Rollout`, `Test` | `HAS_SOURCE` | `Source` | Attach human-reviewed provenance |
| `ReviewRun` | `GENERATED` | `ActivityEvent` | Link an explicit check to its status snapshot and readable history entry |
| `Campaign`, `Draft` | `HAS_PROPOSAL` | `ActionProposal` | Associate a bounded internal action with its campaign and target draft |
| `ReviewRun` | `BASIS_FOR` / `VALIDATED` | `ActionProposal` | Record the check used to create and approve a proposal |
| `ActionProposal` | `HAS_EVENT` | `ActivityEvent` | Record proposal, decision, and execution state changes |

Nodes use stable `id` properties. Deployment, rollout, and test facts also use `current: true`, `environment`, and `reviewed`. A deployment has `revision` and `includesFeature`; a test has `revision` and `passed`. A source has `label`, `text`, `observedAt`, and `reviewedBy`. The checker treats a source as fresh when its timestamp is no more than 30 days before the check time and no more than five minutes in the future. At least one fresh source with an ID and reviewer is required for each current fact used.

The relationships are the product behavior: traversing `Draft → Promise → Feature → Deployment/Rollout/Test → Source` selects the affected claims and the evidence behind each one. `ReviewRun` and `ActivityEvent` record explicit local check and scenario actions; review runs store finding IDs and statuses without copying draft text. This is not a separate visualization over an unrelated data store.

## Status rules

- **Supported:** the reviewed promise and current facts are valid; a reviewed current rollout includes the named audience, a current reviewed deployment includes the feature, and a passing reviewed test matches the deployed revision.
- **Contradicted:** a reviewed, current, fresh-source rollout excludes the named audience.
- **Unknown:** a required fact or source is absent, stale, unreviewed, malformed, or conflicting. An Unknown must not be shown as positive evidence.
- **Not checked:** no promise path is linked to the draft.

Current deployment rows must agree on revision and feature presence. Multiple current rollout records must agree on the audience result. Tests for the running revision must agree. A known, sourced rollout exclusion remains Contradicted even when a later required test is missing.

## Main Cypher patterns

The implemented queries live in [`src/server/checks/campaign.ts`](../src/server/checks/campaign.ts). Representative patterns:

```cypher
MATCH (campaign:Campaign {id: $campaignId})<-[:IN_CAMPAIGN]-(draft:Draft)
OPTIONAL MATCH (draft)-[:MAKES_PROMISE]->(directPromise:Promise)
OPTIONAL MATCH (draft)-[:REUSES_DRAFT]->(reusedDraft:Draft)-[:MAKES_PROMISE]->(reusedPromise:Promise)
WITH campaign, draft, coalesce(directPromise, reusedPromise) AS promise, reusedDraft
OPTIONAL MATCH (promise)-[:ABOUT]->(feature:Feature)
OPTIONAL MATCH (promise)-[:TARGETS]->(audience:Audience)
RETURN DISTINCT draft.id AS draftId, promise.id AS promiseId,
       feature.id AS featureId, audience.id AS audienceId,
       draft.position AS sortPosition
ORDER BY sortPosition
```

```cypher
MATCH (:Feature {id: $featureId})-[:HAS_ROLLOUT]->(fact:Rollout {current: true})
OPTIONAL MATCH (fact)-[:HAS_SOURCE]->(source:Source)
OPTIONAL MATCH (fact)-[:INCLUDES]->(included:Audience)
OPTIONAL MATCH (fact)-[:EXCLUDES]->(excluded:Audience)
RETURN fact.id AS factId,
       collect(DISTINCT included.id) AS includedIds,
       collect(DISTINCT excluded.id) AS excludedIds,
       source.id AS sourceId, source.observedAt AS observedAt,
       source.reviewedBy AS reviewedBy
```

The rollout fact match comes first so a missing source does not hide a current fact; the checker can then return **Unknown**. The implementation similarly loads current deployment and test facts with optional source matches. It supplies `campaignId` and `featureId` as parameters and never interpolates user input into Cypher.

## Fixture transition

The fictional initial graph contains an R17 production deployment with CSV export, a tester-only rollout, a passing R17 smoke test, and three reviewed source records. All-account promises are Contradicted; the tester promise is Supported; an unrelated dashboard draft is Not checked. The S4 demo adds a reviewed rollout that includes all accounts and internal testers, so only the dependent all-account promises change.

All fixture nodes and edges are in [`data/fixtures/csv-launch.json`](../data/fixtures/csv-launch.json). The seed operation uses `MERGE`, coordinates app processes with an expiring fencing lease checked in every write query, clears fixture drafts' mutable promise paths before restoring canonical edges, marks completion last, and retries after a partial failure. It preserves and increments the mutable feature fact revision in the same graph query that writes the completion marker, and fixture-bound reads require the current marker. The demo transition writes only to this synthetic graph; repeated calls confirm the existing S4 state without adding another `rollout.expanded` event or revision. Each explicit follow-up check still gets its own `campaign.checked` history event.

An explicit local `POST /check` creates one `ReviewRun` and one `ActivityEvent` in a single graph query. The event is readable in `GET /activity`, which returns up to 20 newest events. The S4 mutation creates its rollout event in the same query as the synthetic fact update.

Proposal creation stores the check run, finding fingerprint, draft revision, feature fact revision, target audience, and requested action. Approval checks a fresh finding and then uses a single compare-and-set graph query to apply only an internal pause or edit and record both approval and execution events. Edit approval creates a new reviewed promise and relinks only the target draft. Reject records its own event. Resume is a separate reviewer request that requires a fresh Supported finding and matching revisions. These endpoints are limited to local development; reviewer identity is not authenticated, retention controls are not implemented, and external publishing is unavailable.
