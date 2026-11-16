---
name: salo-project-expert
description: Map SALO architecture and cross-system integration from verified code, distinguishing owner requirements, role boundaries, implemented features and tested evidence.
---

# SALO project expert

Read AGENTS.md and .github/copilot-instructions.md before work. Verify origin is
bdkd103-maker/salon and HEAD descends from a8429d368466e38e9a87b4934370220ca4dda91c.
Inspect git status; preserve existing tracked and untracked work.

Start with docs/SALO-PROJECT-KNOWLEDGE.md, docs/SALO-FEATURE-STATUS.md and
docs/SALO-ENGINEERING-BACKLOG.md. Follow code references before accepting their
claims; documentation and filenames alone do not prove a feature works.

Map the requested flow through root/www frontend, /api/v1 routes, authorization,
Prisma relations and SQL constraints. SALO uses HTML/CSS/JS, Fastify/TypeScript,
PostgreSQL/Prisma and Capacitor. CUSTOMER, OWNER, STAFF and ADMIN have distinct
persisted account and salon membership/ownership boundaries.

Label each conclusion: owner requirement, implemented code, verified behavior
(name test and boundary), incomplete, confirmed defect, or unknown. Do not infer
billing, consent, retention, holiday, timezone or staff permissions from UI copy.
Record questions for the owner; continue independent clear work if authorized.

Update the three knowledge documents when evidence changes. Preserve historical
results and distinguish them from current results. Reuse existing queue, SMART,
loyalty and authentication implementations; do not rebuild completed features.

Use docs/SALO-AI-TOOLING.md for commands. Never load .env, contact a database,
start dev:env, install global tooling, deploy, commit or push as a side effect.
Return findings with source paths, evidence limits and the next scoped action.

## Integration workflow

Read `docs/SALO-PRODUCT-REQUIREMENTS.md` and
`docs/SALO-SYSTEM-INTEGRATION.md` alongside the knowledge/status/backlog files.
The current ordered backlog is the single work queue; preserve its historical
batch records without reintroducing resolved issues as open work.

For an integration question, name the actors, frontend entry points, exact
registered routes, persisted authorization, model IDs/enums, transaction and
derived-state consumers. Trace Owner configuration/team -> Customer booking or
ticket -> Staff presence/visit -> SMART occupancy/ETA -> completion/loyalty/
notifications, with Admin gates throughout. Manual walk-in is a separate intake
path, not guest booking. Do not assume bookings automatically enter the queue.

Return an impact map with source links, existing regression evidence, unknowns
and owner decisions. Record source-branch/task-branch/dirty-work provenance;
never assume local review work exists in the fetched development branch.
If that branch lags the approved review lineage, record the difference and
preserve the verified task branch. Do not silently lower revision requirements,
reset to older code or merge unpublished review changes to satisfy a branch name.
