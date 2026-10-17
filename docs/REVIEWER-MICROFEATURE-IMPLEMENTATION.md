# Reviewer microfeatures 1, 2, 4, and 5

Implemented 18 October 2026 in the integrated official app. The data is fictional and scoped to the selected company.

| Feature | Surface | Graph connection | Fail-closed behavior |
| --- | --- | --- | --- |
| Before/after proof | Launch review after rollout; writing handoff after tone approval; Company records after backup approval | Captures graph reads before and after the guarded action. Shows the changed fact or instruction and an unaffected comparison. | No proof strip if the changed fact or old/new instruction cannot be established. |
| Handoff diff | Writing handoff | Looks up the old instruction by the handoff's stored `INCLUDES_INSTRUCTION` IDs, and the current instruction by approved status. | Pending tone is described as pending, never as current. |
| Handover checklist | Company records → Coverage | Separately checks reviewed backup, guide currency, decision link, and direct `CITES_SOURCE` edges. | A missing source or decision says Needs review. A `CITES_DECISION` edge does not count as a source. |
| Unknown next step | Launch review → finding details | Keeps the exact reason from the graph-backed checker, then suggests a review step matched to that reason. | Unrecognized reasons get a general inspect-evidence step; no automated repair occurs. |

Local acceptance: 94 automated tests passed and `npm run build` passed. In a live localhost FalkorDB walkthrough, Alder & Finch tone approval changed revision 1 to 2 while the opening rule remained unchanged; backup approval changed unavailable-owner coverage from Uncovered to Covered by backup while Release QA sign-off remained unchanged; rollout expansion changed the broad-audience finding from Contradicted to Supported while Internal testers remained Supported. Removing the current test produced Unknown with a specific next step. The fictional demo was reset afterward. Both Alder & Finch and Northstar Parcel workspace reads returned separate company notes, guide sources, and current decisions. Production acceptance still requires a deployed build check.

