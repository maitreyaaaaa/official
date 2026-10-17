# One connected official workspace

The local `/app` demonstrates all three Graph Hacks tracks through two fictional companies: Alder & Finch and Northstar Parcel. Each company has its own campaign, writer memory, Company Brain, ownership, and review history in the same FalkorDB graph. This is a synthetic reviewer demo, not a customer-data product. The campaign checker is the source of truth for product availability.

## Three paths through one graph

| Track | Question | Graph path and decision |
| --- | --- | --- |
| Agents That Act on Connected Data | Can this draft claim CSV export for its audience? | `Draft → Promise → Feature → Deployment/Rollout/Test → Source`; reviewed current facts return Supported, Contradicted, Unknown, or Not checked. Internal edits require a separate proposal and human approval. |
| Agent Memory and Coordination | Can a fresh writer continue an old planner handoff? | `Campaign → InstructionVersion`, `Handoff → Task → Campaign`, and `Campaign → ReviewEpisode`; the writer compares the old handoff with the current approved brief, runs the Track 1 check, then records a pending internal `WriterDraft`. Brief and feature-fact revisions fence approval. |
| Company Brain | Who can continue launch evidence review if Maya is unavailable? | `Company → Project → Process → Person` for ownership, then `Process → KnowledgeNote → Source/Decision` for the handover. A pending backup does not count. An approved `BACKUP_OWNER` changes coverage. The unrelated QA process is a control. |

Alder & Finch's eight browsable company notes have full text, linked notes, backlinks, and direct source or decision records. The browser groups their original categories under Launch, Operations, and Company. The audience decision is explicitly dated; its historical tester-only wording must not be read as the live rollout after a demo scenario changes. The handover view marks the guide incomplete when the current rollout no longer matches the reviewed decision.

The Company Brain opens on a pannable, zoomable graph of note links. Selecting a node opens its full note, backlinks, and cited sources. The Notes tab provides a searchable keyboard-friendly list. The company switcher at the foot of the sidebar swaps all views to Northstar Parcel's separate delivery-timeline example: nine notes, a pilot-merchant rollout, a reviewed N24 test, Iris as the launch-claim owner, and Nolan as a proposed backup.

The right chat checks graph records and the campaign checker on each question. It returns structured answers with clickable company-note citations. It does not call an LLM or take action. The optional Track 1 OpenAI assistant is in the collapsed Advanced campaign AI section of that same panel.

The Plugins view lists 25 sources across messages, meetings, projects, customer work, and infrastructure. Search, category, and connected-only filters work per company. A demo connection is only a browser-local selection for that company; it neither signs in to a provider nor imports data into the graph. Each card's detail panel describes a possible future source and its use without presenting it as connected evidence.

## Local walkthrough

1. Start the documented FalkorDB stack and `npm run dev`. Open `http://127.0.0.1:3001/app`. The app initializes fixture `connected-companies-v11` when seeding is enabled.
2. Use the three-step guide on Launch review. First inspect the baseline claim and its source path: two Contradicted, one Supported, one Not checked. Changing rollout or test evidence changes only dependent findings. Campaign activity is lower on this same page.
3. Open Agent memory. Inspect handoff revision 1, approve the calm tone if pending, then start a fresh writer. Its draft uses the current approved tone, reviewed opening, and live evidence result. The text stays pending until a person approves it internally. If rollout or test facts change, approval of that old draft returns 409 and the UI labels it historical.
4. Open Company Brain. Search and open a note, follow backlinks, and inspect dated source records. Simulate Maya unavailable. Without a confirmed backup, the process is Uncovered. Propose Zara: coverage stays Uncovered. Approve: coverage becomes Covered by backup; Release QA remains covered by Ines. The internal handover names the guide, decision, and source links. Expanding the rollout makes the old guide incomplete until reviewed against that change.
5. Ask the right chat about drafts, the writer handoff, ownership, or notes. A note citation opens its reader. The optional campaign AI controls are under Advanced campaign AI in the same panel.
6. Use Reset fictional demo to replay. It restores canonical draft copy and promise links, the limited rollout and production test, the proposed tone, and the unassigned launch backup. It starts a new visible run for writer drafts, proposals, and activity. Earlier records remain in FalkorDB history; old writer drafts and proposals cannot be approved in the new run. The reset requires the same fictional-demo write guard as other mutations.

7. Use the company switcher at the bottom left to choose Northstar Parcel. Its delivery-timeline launch has a separate review, writer handoff, nine-note graph, and coverage roster. Reset acts on the selected company only.

## Verified locally on 2026-10-17

- The TypeScript/Vite build and 88 deterministic tests pass.
- Live FalkorDB accepted the v9 fixture and returned eight notes, linked sources, versioned instructions, and process ownership. v8-to-v9 seeding preserved an approved tone, backup assignment, and existing writer history while updating the dated note copy.
- The unavailable-owner result changed from Uncovered to Covered by backup only after assignment approval; the QA control did not change.
- The writer produced tester-only, all-account, and no-availability-claim copy from three distinct live evidence states. The fact revision changed with rollout evidence. A stale draft approval returned 409; rejecting it remained possible.
- Expanding rollout made the old guide incomplete; restoring baseline made it current again. Browser review confirmed Company Brain note navigation, clickable chat citations, the right panel, and the close/open sidebar control.
- The simplified three-item navigation, three-step launch guide, grouped Brain filters, and single agent panel were checked in the local browser. Live replay restored the baseline; fresh approval, writer, and backup actions worked. A proposed backup did not change unavailable-owner coverage, while approval did. Reset hid prior activity and proposals from the current view, allowed a new proposal for the same draft, and rejected approval of an old writer draft with 409.

## Current boundaries

- The two-company extension was verified locally on 2026-10-18: build and 88 deterministic checks passed; FalkorDB returned four expected findings for each company, eight Alder notes and nine Northstar notes. Northstar's tone approval, writer session, backup proposal and approval, and reset completed while Alder's brief and backup stayed unchanged. Browser review confirmed switching companies and opening a graph node with the correct note and citations.
- The integrated workspace and compact Overview reached the [public Vercel alias](https://official-sand.vercel.app/app) on 2026-10-18. Production read-only browser review confirmed the Overview, Launch review drafts, Company Brain notes, and connected FalkorDB health. The integrated approval and writer mutations were previously exercised locally; they were not replayed on this production release.
- There is no authenticated reviewer identity, customer ingestion, automatic crawling, background scheduling, external publishing, or real customer data. Fixed demo approvals record the fictional reviewer name in graph records; they do not authenticate that person.
- Writer copy and workspace chat are deterministic, bounded demo behavior. The handover is an internal brief; it is not sent to anyone.
- The two companies are fixed fictional demo fixtures. There is no customer onboarding or company data import.
