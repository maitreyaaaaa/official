# Architecture

## Product shape

**official** is one launch workspace with three graph-backed slices: claim checking, versioned agent memory, and company handover. The campaign check runs on request; background detection is not implemented. Each finding links the exact draft promise to its feature, deployment, rollout, audience, test, and sources. The memory and company slices use the same campaign and fictional Alder & Finch graph.

AirJelly is a product-experience reference for timely suggestions, reusable context, and an activity timeline. official applies those patterns to campaign facts and review actions. It does not capture desktop screens or build general personal memory.

## Data and decision path

FalkorDB stores the connected campaign facts and relationships used to select affected drafts. The server runs fixed, parameterized Cypher queries. A deterministic checker maps reviewed facts to:

- **Supported** — current reviewed evidence satisfies the promise for its named audience.
- **Contradicted** — current reviewed evidence clearly excludes that audience or disagrees with the promise.
- **Unknown** — required evidence is missing, stale, unreviewed, or conflicting.
- **Not checked** — no reviewed promise is linked to the draft for this check.

Unknown and Not checked must never be shown as a positive result. FalkorDB failure must stop the check rather than serve stale Supported findings as current.

## User flow

1. The user opens the fictional CSV launch campaign and sees the latest check and items needing review.
2. The user can run a deterministic campaign check or ask the optional assistant a bounded question.
3. The server traverses the graph, applies fixed rules, and returns findings with their evidence paths.
4. The review feed surfaces affected drafts returned by the graph check. A later step will trigger a recheck when product facts change.
5. A person can create a bounded pause/edit proposal in the review queue. The optional assistant uses the shared named-tool registry to explain findings or prepare the same pending proposals.
6. The local UI and API can approve or reject proposals. Approval rechecks the finding and draft/fact revisions. No publication or live rollout controls are available.
7. Activity history records checks, synthetic rollout changes, proposals, and decisions. Authenticated reviewer identity and failure logging remain planned.

The current implementation also covers the graph-backed memory and company workflow described below. Review reads are restricted to the fictional campaign and project. Local FalkorDB and browser flows have been exercised against the pinned server; authenticated production access and external integrations are not implemented.

## Module boundaries

- `src/client/` — campaign workspace, review feed, evidence trail, proposal queue, and Activity history.
- `src/server/index.ts` — local API routes and development server; production serving is blocked until access control is implemented.
- `src/server/graph/` — FalkorDB connection, fixture loading, and fixed Cypher queries.
- `src/server/checks/` — deterministic promise-status rules.
- `src/server/agent/` — shared validated tool contracts, OpenAI Responses orchestration, and the stdio MCP server.
- `src/server/review/` — proposal creation, approval, rejection, explicit resume, and stale-basis checks.
- `src/server/activity/` — status-only check snapshots and human-readable activity events.
- `src/server/workspace/` — bounded graph reads, versioned writer and backup actions, and structured workspace chat.
- `src/shared/` — shared request and response types.
- `data/fixtures/` — fictional campaign and connected company data only.

## Connected workspace

The writer checks the current approved instruction versions, old planner handoff, reviewed episode, and Track 1 campaign evidence before preparing an internal draft. Its graph record includes the brief and feature-fact revisions. Approval compares both revisions again. A changed brief, rollout, or test makes the old draft stale; rejection remains possible. Writer copy is deterministic demo drafting, not an OpenAI generation.

The Company Brain loads `Company → Project → Process → Person` ownership and `Process → KnowledgeNote → Source/Decision` evidence. A missing backup remains uncovered when the primary is unavailable. A proposed backup does not change the relationship; human approval creates `BACKUP_OWNER` and records an event. The internal handover is ready only with a reviewed roster, approved backup, guide current with the rollout, and a direct source link. The release QA process is a control that must stay unchanged.

The right chat routes bounded questions to live graph reads and the deterministic campaign checker. It cites linked company notes and makes no external changes. See [Connected workspace](CONNECTED-WORKSPACE.md) for the walkthrough and current limits.

## Evidence freshness

Every current deployment, rollout, and test used in a finding needs at least one source with a stable ID, a reviewer, and an `observedAt` timestamp no more than 30 days before the check. Timestamps more than five minutes in the future are invalid. Missing or stale provenance produces **Unknown**. The current fixture uses reviewed `Source` nodes for all three fact types.

## Initial fixture contract

The first graph contains one campaign, four drafts, two reviewed promises, the R17 production record, a tester-only rollout, a passing R17 functional check, and source records. The all-account landing page and email are Contradicted; the tester post is Supported; the dashboard copy is Not checked for CSV export. Replacing the rollout with all-account access should change only dependent findings. Missing tests and conflicting rollout facts must produce Unknown as specified in the workspace planning source.

The exact labels, relationships, current markers, status rules, and representative Cypher are in [Graph model and queries](GRAPH-MODEL-AND-QUERIES.md). The source code is authoritative if this document and implementation drift. Live Cypher execution against the pinned image was verified locally for the integrated workspace on 2026-10-17.
