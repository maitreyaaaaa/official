# official

**official** is the standalone Track 1 application for the Graph Hacks track **Agents That Act on Connected Data**. It checks whether draft launch promises match reviewed deployment, rollout, and test evidence for the audience named by each promise.

FalkorDB is part of the decision path: graph relationships connect drafts to promises, audiences, product facts, and evidence sources. The current slice runs on request and returns a source trail. Background monitoring, an agent, proposal approval, and persistent activity history are planned phases.

The workspace takes product interaction cues from [AirJelly](https://www.airjelly.ai/en), while focusing on launch claims. The fixture is entirely fictional. A finding is not an approval to publish. The demo rollout action changes only the local synthetic graph.

## Current scope

- A fixed, parameterized FalkorDB checker returns **Supported**, **Contradicted**, **Unknown**, or **Not checked** for linked draft promises.
- Missing, stale, unreviewed, or conflicting fact sources fail closed to **Unknown**. A reviewed current rollout exclusion can produce **Contradicted** for its named audience.
- Checks are read-only. The optional S4 scenario action updates the fictional local graph and rechecks it; it does not change drafts or contact external systems.
- The server serves only in `NODE_ENV=development` until authentication and authorization are implemented.
- [Implementation status](docs/IMPLEMENTATION-STATUS.md) lists the verified code paths and remaining work. [Graph model and queries](docs/GRAPH-MODEL-AND-QUERIES.md) documents the schema and decision queries.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- Docker Engine with the Docker Compose plugin, or another FalkorDB 6 server reachable from the local app

## Local setup

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
npm ci
npm run dev
```

Open `http://127.0.0.1:3001`. The development client sends a same-origin POST to initialize the fictional fixture when `SEED_FIXTURE=true`, then loads the campaign review. The expected initial statuses are:

| Draft | Expected status |
| --- | --- |
| Landing page | Contradicted |
| Launch email | Contradicted |
| Tester announcement | Supported |
| Dashboard update | Not checked |

The “Simulate all-account rollout” control writes the reviewed S4 rollout to the local `official` graph and reruns the check. The landing page and launch email should then become **Supported**. This is synthetic fixture data.

Useful local endpoints:

- `GET /api/health` runs a FalkorDB readiness query and returns `200` when connected or `503` otherwise.
- `GET /api/campaigns/campaign-csv-launch/review` reads campaign data and returns findings. It does not seed or mutate the graph.
- `POST /api/campaigns/campaign-csv-launch/fixture` initializes the sample only when local development, the fixture opt-in, loopback database, loopback caller, and same-origin checks pass.

Compose binds FalkorDB ports to loopback. `.env.example` uses the local graph name `official`. Remote FalkorDB connections require `FALKORDB_TLS=true`; keep credentials in `.env` and never expose them to the client.

## Checks

```powershell
npm test
npm run build
npm audit --audit-level=moderate
```

The deterministic tests use a query double. They verify decision rules and fixture retry behavior, but do not prove that the Cypher executes against a live FalkorDB server. Start Compose and open `/api/health` to verify the local database connection.

## Submission readiness

- The public repository is `maitreyaaaaa/official`.
- A demo video has not been recorded or linked yet.
- AI assistance disclosure: Codex assisted with research, implementation, and documentation. The project owner must review the final submission and demo.

Track 2 and Track 3 remain separate applications and repositories.
