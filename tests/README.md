# Verification

Run `npm test` for deterministic regression tests of the campaign decision rules and fixture recovery. These tests use a query double, so they do not prove that Cypher runs against FalkorDB. Run `npm run build` for TypeScript and the Vite production client bundle. `npm audit --audit-level=moderate` checks dependency advisories. Live graph verification requires a running FalkorDB instance.
