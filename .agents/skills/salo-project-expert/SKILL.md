---
name: salo-project-expert
description: Explain SALO architecture, roles, workflows and feature status from verified repository evidence, distinguishing owner requirements from implementation and uncertainty.
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
