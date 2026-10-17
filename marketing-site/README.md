# Marketing site

The marketing frontend is a static React experience mounted at `/`, `/review`, `/method`, and `/guardrails`. It explains official in plain language, shows the claim-to-evidence path, and links reviewers to the working application at `/app`.

The pages do not call the campaign API or perform actions. Their Alder & Finch example is fictional and illustrative. The 3D evidence guide is a decorative generated image; CSS depth, sparse Motion entrances, and the evidence path animate around it. Reduced-motion preferences disable continuous motion. The official mark and wordmark are exact SVG exports derived from the current site mark and type treatment.

## Page map

- `/` — product overview, workflow, connected workspace areas, result meanings, and human-control boundaries.
- `/review` — a plain-language example of a contradicted launch promise.
- `/method` — the campaign-to-source evidence path.
- `/guardrails` — human approval and evidence boundaries.
- `/app` — working campaign review, agent memory, and company knowledge workspace.
- Unknown paths resolve to the branded 404 page; unknown `/api` endpoints return JSON 404 responses.

The pathname switch lives in `src/client/main.tsx`. Vite serves the same SPA entry for these routes; the API and graph model are not duplicated.
