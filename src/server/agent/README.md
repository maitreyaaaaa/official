# Agent and MCP tools

`tools.ts` is the shared tool registry for the OpenAI Responses assistant and the stdio MCP server. Both surfaces use Zod schemas before graph actions. Tool IDs and Cypher remain server-controlled; the current registry is restricted to the fictional `campaign-csv-launch` fixture.

The five tools are:

- `check_campaign` runs deterministic checks and optionally records a status-only run.
- `explain_promise` returns one draft's finding and bounded evidence.
- `find_affected_drafts` finds current findings linked to the CSV export feature.
- `compare_checks` compares two saved status snapshots without returning draft copy.
- `propose_draft_action` is not advertised to the model or MCP client when local proposal writes are disabled. With explicit boolean `allowProposal: true`, the HTTP assistant can return one unsaved proposal preview after an explicit user request; a separate user action saves it as pending, and a human must approve it before application. An explicit MCP tool call can create a pending proposal directly; approval remains a separate human action.

The HTTP assistant is optional and local-only. It requires `OPENAI_API_KEY`, uses `OPENAI_MODEL` or `gpt-6.1-sol`, sends prompts and synthetic tool results to OpenAI, calls one tool at a time, and stops after four tool calls. Proposal permission defaults off and the model instructions still require an explicit proposal request. It cannot execute publication, edit facts, or apply proposals. Do not enter sensitive information.

Run `npm run mcp` to expose the same tools to a local MCP client over stdio. The process writes protocol traffic to stdout and diagnostic readiness to stderr. Persistent checks, fixture seeding, and proposals follow the local environment flags.

These tools have unit coverage with deterministic graph doubles. The live FalkorDB server is not available in the current Windows environment, so the Cypher and full MCP graph calls remain unverified against a real server.
