# official

**official** is one connected Graph Hacks application spanning **Agents That Act on Connected Data**, **Agent Memory and Coordination**, and **Company Brain**. It checks launch claims against product evidence, lets a fresh writer resume an approved brief, and shows who can carry the launch review with linked company notes.

FalkorDB is part of the decision path: graph relationships connect drafts to promises, audiences, product facts, and evidence sources. The current slice runs on request, returns a source trail, persists local Activity history, and supports a visible stale-checked approval flow for internal draft actions. Optional assistant and MCP tools use the same bounded graph operations.

The shared Alder & Finch Commerce workspace is fictional. One FalkorDB graph connects the campaign, feature facts, planner handoff, reviewed instructions, people, processes, dated company notes, decisions, and source records. All records are synthetic. The right-side workspace chat answers bounded questions from the graph without a model call; its collapsed advanced section offers optional OpenAI campaign assistance only when configured and disclosed. No draft is sent or published. See [Connected workspace](docs/CONNECTED-WORKSPACE.md) for the integrated graph paths and demo walkthrough.

## Current scope

- **Track 1:** The existing campaign checker and approval-first internal proposal queue remain the evidence core.
- **Track 2:** A planner handoff at brief revision 1, a later approved tone, and a dated editorial review are connected to a fresh writer session. The server reads the current campaign check before preparing copy. The draft records brief and fact revisions and cannot be approved if either changed.
- **Track 3:** The Company Brain sidebar opens searchable, categorized notes with full text, backlinks, source records, and an internal handover view. An unavailable-owner scenario reads the reviewed roster and backup link. A pending backup proposal does not count as coverage; approval changes the answer while an unrelated QA process stays unchanged.
- A right-side chat answers questions about draft status, memory, company notes, owners, and workflow activity from current graph reads with clickable note citations. This is structured, deterministic assistance, not a general language model.

- A fixed, parameterized FalkorDB checker returns **Supported**, **Contradicted**, **Unknown**, or **Not checked** for linked draft promises.
- Missing, stale, unreviewed, or conflicting fact sources fail closed to **Unknown**. A reviewed current rollout exclusion can produce **Contradicted** for its named audience.
- `GET /review` is read-only. Fixture-bound requests wait for a seed running in this process and require the current fixture completion marker, so a partially seeded graph is not reviewed. A graph-backed lease fences every fixture write, including a paused process whose lease has expired. The local development app uses a guarded `POST /check` to record the check time and status-only snapshot; it does not store draft text. The S4 rollout and reversible missing-test scenario controls update the fictional local graph, record each real transition, and recheck it. Repeating either action does not duplicate its transition event or increment the fact revision again; each follow-up check gets its own history entry. The scenario write itself contacts no external system.
- A local proposal can pause a contradicted draft or replace its text and linked promise for a named audience. Creation never changes a draft. Only an explicit approve action applies it after a fresh check and revision comparison; reject and resume are separate reviewer actions. No action publishes content or changes live product settings.
- Five bounded tools provide campaign checks, one-draft explanations, affected-draft lookup, status-only saved-check comparisons, and proposal preparation. The assistant only returns an unsaved proposal preview; a user click is required to save a pending proposal. An explicit MCP proposal tool call may create a pending proposal. Neither path applies a proposal. No raw Cypher is exposed. The optional assistant is local-development-only, uses one tool call at a time, has a four-call limit, and sends the prompt and synthetic tool results to OpenAI when configured. The API defaults proposal permission to false and rejects non-boolean permission values. `.env.example` uses `OPENAI_API_KEY` and optional `OPENAI_MODEL`; the key stays server-side.
- `npm run mcp` starts the same tools over stdio for an MCP client. Fixture seeding, history writes, and proposals follow the local opt-in flags.
- Local requests require a loopback client and Host header. A hosted reviewer demo is available only with `ENABLE_PUBLIC_DEMO=true`, and only on the exact Vercel deployment or production host. Demo writes require same-origin HTTPS. JSON and other request bodies are limited to 8 KiB. Reviewer identity and account authentication are not implemented.
- [Implementation status](docs/IMPLEMENTATION-STATUS.md) lists the verified code paths and remaining work. [Graph model and queries](docs/GRAPH-MODEL-AND-QUERIES.md) documents the schema and decision queries.

## Requirements

- Node.js `>=22` (required by the installed FalkorDB client)
- Docker Engine with the Docker Compose plugin, or another FalkorDB 6 server reachable from the local app

## Local setup

From the repository root in PowerShell on Windows with Docker Engine installed in the Ubuntu WSL distribution:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$wslDistro = "Ubuntu"
$repoLinuxPath = (wsl.exe -d $wslDistro -u root -- wslpath -a (Get-Location).Path).Trim()
wsl.exe -d $wslDistro -u root -- systemctl start docker
# Keep the WSL distribution alive after this PowerShell command finishes.
$wslKeepAlive = Start-Process -FilePath "wsl.exe" -ArgumentList @("-d", $wslDistro, "-u", "root", "--", "sleep", "infinity") -WindowStyle Hidden -PassThru
$composePath = "$repoLinuxPath/compose.yaml"
wsl.exe -d $wslDistro -u root -- docker compose -f $composePath up -d
npm ci
npm run dev
```

The hidden `sleep infinity` process keeps Ubuntu running so its Docker daemon and FalkorDB container remain reachable after each `wsl.exe` command exits. To stop just the keepalive from the same PowerShell session, run `Stop-Process -Id $wslKeepAlive.Id`; WSL will stop when its remaining processes exit. To stop the local stack and WSL runtime, run this from another PowerShell window in the repository:

```powershell
$repoLinuxPath = (wsl.exe -d Ubuntu -u root -- wslpath -a (Get-Location).Path).Trim()
wsl.exe -d Ubuntu -u root -- docker compose -f "$repoLinuxPath/compose.yaml" down
wsl.exe --terminate Ubuntu
```

## Vercel reviewer demo

The Vercel entry point serves the Express API as a function and the built Vite site as static files. Set these **server-side** environment variables for the Production environment:

```text
ENABLE_PUBLIC_DEMO=true
SEED_FIXTURE=true
ENABLE_DEMO_WRITES=true
FALKORDB_HOST=<host from FalkorDB Connect>
FALKORDB_PORT=<port from FalkorDB Connect>
FALKORDB_TLS=false
ALLOW_INSECURE_FALKORDB=true
FALKORDB_USERNAME=<database username>
FALKORDB_PASSWORD=<database password>
FALKORDB_GRAPH=official
```

FalkorDB Free does not provide TLS or persistence. `ALLOW_INSECURE_FALKORDB` is an explicit demo-only override: database credentials, queries, and results travel without TLS between the Vercel function and FalkorDB. Use only synthetic reviewer data. The fixture can be recreated after a database restart. The app still exposes only its fixed, validated demo operations; it does not accept arbitrary Cypher or publish content.

Vercel supplies `VERCEL_URL` for each deployment and `VERCEL_PROJECT_PRODUCTION_URL` when a production domain is configured. The app checks the incoming Host against those values and requires same-origin HTTPS for demo writes. Keep database credentials out of `VITE_` variables and out of Git.

The Docker service is enabled under systemd in Ubuntu, so it starts when the distro starts. Run the setup block again to restart the local runtime. With Docker Engine already available in the current shell, use `docker compose up -d` instead and omit the WSL keepalive step.

Open `http://127.0.0.1:3001` for the marketing site. The product demo lives at `/app`; it sends a same-origin request to initialize the fictional fixture when `SEED_FIXTURE=true`, then loads the campaign review.

- `http://127.0.0.1:3001/` — public-facing marketing home page.
- `/review`, `/method`, and `/guardrails` — the three supporting marketing pages.
- `/app` — the integrated campaign review, agent memory, Company Brain, and workspace chat.
- Unknown browser paths show a branded 404 page; unknown `/api` routes return JSON 404 responses.
- API requests are limited to 120 per minute per local client address. The server remains loopback-bound and development-only; this limit is a local safeguard, not production access control.

The marketing frontend is in `marketing-site/frontend`. The single working backend remains in `src/server`; the marketing pages link to the application at `/app` and do not create a duplicate backend or a second data store. See [`marketing-site/README.md`](marketing-site/README.md) for the boundary and page map.

The expected initial statuses in `/app` are:

| Draft | Expected status |
| --- | --- |
| Landing page | Contradicted |
| Launch email | Contradicted |
| Tester announcement | Supported |
| Dashboard update | Not checked |

The app starts with a four-step **Reviewer walkthrough**. It explains the campaign, opens the landing-page evidence, changes access from internal testers to all accounts, and points to the human review queue. The rollout control also restores tester-only access. Each change runs the check again, updates the fact revision, and records an activity event. The result names the status for each draft. No draft text changes.

Reviewer path: open `/`, select **Start the reviewer walkthrough**, then follow the four steps at the top of `/app`. The starting records are fictional. The first check should show two Contradicted drafts, one Supported draft, and one Not checked draft. Expand access to all accounts, read the per-draft result, then restore tester-only access. The app records each real change in Activity.

The **Demo scenarios** menu also has a reversible test control. Remove the current synthetic production test to see dependent promises become **Unknown**. Restore the test to return to the baseline. Every change updates the activity history and reruns the check. All controls change only fictional local fixture data.

When `ENABLE_DEMO_WRITES=true`, explicit same-origin campaign checks and scenario actions record status-only review runs and readable events. The Activity panel shows the latest 20 check, rollout, test-scenario, proposal, rejection, and resume events. This is local synthetic history; user identity and retention controls are not implemented.

Useful local endpoints:

- `GET /api/health` runs a FalkorDB readiness query and returns `200` when connected or `503` otherwise.
- `GET /api/capabilities` reports only booleans for local demo rollout and assistant availability; it never returns credentials.
- `POST /api/assistant` accepts a 1–2000 character question only from the exact local same-origin demo. Optional `allowProposal` defaults to `false`; setting it to `true` adds the proposal-preview tool for that request. The tool rechecks the current evidence and returns an unsaved preview. The user must select **Create pending proposal** to save it, and a separate human reviewer must approve it. The assistant remains unavailable until an API key and local demo-write settings are configured.
- `GET /api/campaigns/campaign-csv-launch/review` reads the fictional campaign and returns findings. Other campaign IDs are rejected; this route does not seed or mutate the graph.
- `POST /api/campaigns/campaign-csv-launch/check` records a local check run and activity event when the fixture and demo-write opt-ins, loopback caller, and same-origin checks pass.
- `POST /api/campaigns/campaign-csv-launch/demo-test-state` accepts `{ "available": boolean }`, updates the synthetic current test state, and reruns the campaign check under the same local write guards.
- `POST /api/campaigns/campaign-csv-launch/demo-rollout` accepts `{ "expanded": boolean }`; `true` opens access to all accounts and `false` restores tester-only access.
- `GET /api/campaigns/campaign-csv-launch/activity` returns the latest 20 persisted events for the fictional campaign.
- `POST /api/campaigns/campaign-csv-launch/drafts/:draftId/proposals` creates a bounded pause or edit proposal for a currently contradicted draft.
- `GET /api/campaigns/campaign-csv-launch/proposals` lists the latest 20 proposals. Explicit `/approve` and `/reject` endpoints transition pending proposals; stale approval returns `409` and records `needs_recheck`.
- Edit proposals require current reviewed evidence that supports the selected target audience; creation and approval both recheck that audience. Only one pending proposal can exist per draft.
- `POST /api/campaigns/campaign-csv-launch/drafts/:draftId/resume` resumes a paused draft only after a fresh Supported result.
- `POST /api/campaigns/campaign-csv-launch/fixture` initializes the fictional workspace only when local development, the fixture opt-in, loopback database, loopback caller, and same-origin checks pass.

Compose pins FalkorDB 6.0.2, runs a Redis health check, and binds its ports to loopback. `.env.example` uses the local graph name `official`. Remote FalkorDB connections require `FALKORDB_TLS=true`; keep credentials in `.env` and never expose them to the client.

## Checks

```powershell
npm test
npm run build
npm audit --audit-level=moderate
```

To connect an MCP client locally, configure it to launch `npm run mcp` from this repository. The stdio server exposes the same five bounded tools; it writes protocol messages to stdout and operational messages to stderr.

The deterministic tests use a query double. They verify decision rules, status-only history payloads, and fixture retry behavior, but do not prove that the Cypher executes against a live FalkorDB server. Start Compose and open `/api/health` to verify the local database connection.

## Submission readiness

- The public repository is `maitreyaaaaa/official`.
- A demo video has not been recorded or linked yet.
- AI assistance disclosure: Codex assisted with research, implementation, and documentation. The project owner must review the final submission and demo.

Track 2 and Track 3 remain separate applications and repositories.
