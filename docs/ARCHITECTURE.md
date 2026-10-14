# Architecture outline

This is the initial code-free structure for **official**. The detailed product, interface, graph, fixture, and evaluation decisions remain in the workspace at `D:\Project 101\Documents\Track-1-official\`; they are not bundled into this repository.

## Proposed request flow

1. The client submits a campaign check or opens a saved finding.
2. Server API modules validate inputs and call fixed, parameterized graph queries.
3. The checker applies reviewed-fact rules and records the facts used for Supported, Contradicted, or Unknown.
4. The agent may select a small set of named tools to explain findings or draft a proposal. It has no arbitrary Cypher or publishing permission.
5. The review service applies an internal draft change only after explicit human approval and a freshness check.
6. Activity history records checks, proposals, decisions, and failures.

## Proposed module boundaries

- `src/client/` — campaign, product fact, review queue, and activity UI.
- `src/server/api/` — validated application endpoints.
- `src/server/graph/` — FalkorDB connection and fixed Cypher queries.
- `src/server/checks/` — deterministic promise status rules.
- `src/server/agent/` — constrained orchestration and named tool contracts.
- `src/server/review/` — approval, rejection, pause, resume, and stale-proposal checks.
- `src/server/activity/` — human-readable history.
- `src/shared/` — shared data contracts.
- `data/fixtures/` — fictional records only.
- `tests/` — expected fixture and approval behavior.

Framework, exact graph labels, client version, query syntax, and runtime commands remain to be selected and verified during implementation.
