# official

**official** is the Track 1 project for the FalkorDB hackathon, *Agents That Act on Connected Data*.

It checks whether launch drafts make promises supported by reviewed product facts for the audience named in each promise. It traces each finding through FalkorDB and proposes targeted draft changes for a person to review.

## Current scope

This repository is initialized with a code-free application structure. Product behavior and implementation remain to be built. The first demo is planned around a fictional CSV export launch with four drafts, reviewed rollout and test facts, and explicit Supported, Contradicted, and Unknown results.

- FalkorDB must determine which drafts are affected and why.
- Missing or conflicting evidence must not produce a Supported result.
- Draft pauses and edits require a human approval step.
- The app does not publish campaign content or change live product settings.
- Use fictional, public, or participant-owned data only.

## Repository layout

- `src/client/` — campaign review experience
- `src/server/` — API, FalkorDB queries, checks, agent tools, approvals, and activity history
- `src/shared/` — types and contracts shared by client and server
- `data/fixtures/` — fictional demo data
- `docs/` — architecture and implementation notes
- `tests/` — checks for the fixed demo cases

## Development status

No application runtime, dependencies, or product behavior have been added yet. Setup commands will be documented after the runtime and framework are selected.

The planning source set remains in the workspace at `D:\Project 101\Documents\Track-1-official\`; it is not bundled into this application repository. Track 2 and Track 3 have separate application folders and repositories.
