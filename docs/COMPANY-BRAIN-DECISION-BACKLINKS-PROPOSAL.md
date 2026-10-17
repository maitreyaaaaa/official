# Company Brain: decision origins and typed nodes

**Status:** Product proposal only. No decision-origin or node-type behavior is implemented by this document.

## What exists today

The graph canvas renders company notes. Notes already have note-to-note links and backlinks. A note can cite a source or decision record, but those records are plain text inside the note reader; they are not selectable graph nodes. The current fixture has reviewed decision text and source records for two fictional companies. Demo plugin connections do not import real Slack, email, meeting, or ticket data.

## Recommended interaction

Keep the whole-company graph for exploration, but make the selected node's detail panel the reliable place to answer **“Why was this decided?”** A Decision node opens a compact record with: the decision, status, owner and review date, the discussion or source where it originated, the alternatives considered when recorded, and what it affects. An **Open origin** action opens the exact in-app discussion/source record. A **Used by** section lists incoming backlinks from notes, processes, and drafts. If origin evidence is missing, show **Origin not recorded** and a review action rather than inventing provenance.

Use a small taxonomy: **Decision, Discussion, Source, Note, Process**. “Completed” is a status on a task/process or decision, not a node type: otherwise one record could change identity whenever its work state changes. Give each type a text label and shape as well as color, and offer filters for type, status, and the current node's neighborhood. Keep the Notes/list view as a keyboard-accessible route to the same detail record. Obsidian's graph groups, filters, local graph, and backlinks are useful interaction references, while official should show explicit business relationship names and provenance. [Obsidian graph view](https://obsidian.md/help/plugins/graph), [Backlinks](https://obsidian.md/help/plugins/backlinks).

## Data relationship sketch

Proposed graph edges are `DECIDED_IN` (Decision → Discussion), `SUPPORTED_BY` (Decision → Source), `APPROVED_BY` (Decision → Person), `AFFECTS` (Decision → Process/Note/Draft), and `SUPERSEDES` (Decision → Decision). A decision's “where” link comes only from a stored edge and opens a record belonging to the same company. FalkorDB's pattern matching and optional matches can support the detail and incoming-link queries; specific schema and query bounds need design before implementation. [FalkorDB Cypher reference](https://docs.falkordb.com/cypher/).

## Staging and acceptance

1. First make the existing decision and source records selectable, with typed labels and a detail panel. Seed one complete decision → discussion/source → affected process path per fictional company. Preserve current note links.
2. Add inbound backlinks and one-hop filters. Cap initial rendered nodes, load deeper neighborhoods on request, and keep the list route usable without canvas interaction.
3. Only after real connectors exist, allow an external deep link to its original discussion with permission checks. Until then, label all origins as fictional in-app records.

Acceptance: opening a decision shows its exact stored origin and incoming uses; removing an origin edge removes the link and displays Origin not recorded; a decision from company A cannot open a company B record; keyboard users can reach the same details from the list; a superseded decision stays visible but clearly historical. Assume a small demo graph first, no private provider data, read-only decision browsing, and a maintained set of relationship types. These are design assumptions, not confirmed product requirements.
