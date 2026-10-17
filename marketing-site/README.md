# Marketing site

The marketing frontend is a static React experience mounted at `/`, `/review`, `/method`, and `/guardrails`. It introduces the Track 1 concept and links to the working campaign review application at `/app`.

The marketing pages do not call the campaign API, load graph data, or perform actions. Their on-page review is illustrative and uses fictional content for Alder & Finch Commerce. The working application, API, graph connection, and local demo controls remain in `src/client`, `src/server`, and the `official` FalkorDB graph.

## Page map

- `/` — product overview and evidence-map illustration.
- `/review` — static example of a contradicted launch promise.
- `/method` — static explanation of the draft-to-audience evidence path.
- `/guardrails` — product boundaries and approval principles.
- `/app` — working campaign-review UI and local demo workflow.
- Unknown paths resolve to the branded 404 page; unknown `/api` endpoints return JSON 404 responses.

The pathname switch lives in `src/client/main.tsx`. Vite serves the same SPA entry for these routes; the server and data model are not duplicated.
