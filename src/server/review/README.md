# Human review

`review.ts` creates bounded pause/edit proposals only for currently Contradicted drafts. Edit proposals also require the selected audience to be Supported by fresh reviewed evidence, both when the proposal is created and when it is approved. Only one pending proposal can exist for a draft. Each proposal captures a fresh run ID, full finding fingerprint, and the draft and feature fact revisions.

Approval rechecks the finding, marks changed proposals `needs_recheck`, and uses an atomic graph query to compare revisions before applying an internal draft action. Edit approval creates a new reviewed promise and relinks only that draft. Rejection is explicit. Resume is a separate action and requires a fresh Supported result. No publishing or live product controls are available.

These APIs are restricted to the local synthetic campaign. Reviewer identity is not verified and production authorization is not implemented.
