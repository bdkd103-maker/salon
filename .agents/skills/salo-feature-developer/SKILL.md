---
name: salo-feature-developer
description: Implement owner-approved SALO features within the existing architecture, integrating frontend, API, authorization, localization and isolated regression coverage.
---

# SALO feature developer

Read AGENTS.md, .github/copilot-instructions.md, salo-project-expert and
docs/SALO-AI-TOOLING.md. Verify repository/revision and preserve existing work.

Require an explicit feature request with acceptance criteria. Inspect existing
implementation first; do not create a second queue, rewards ledger, auth flow
or owner workspace. Separate approved requirements from unanswered decisions.
For unclear policy, document the question and proceed only on independent work.

Plan a vertical slice: UI state/loading/error behavior, API paths and payloads,
persisted role/account/salon authorization, domain lifecycle, and storage effects.
Capture the exact source scope before editing. Prefer existing helpers and
contracts; no architectural rewrite, new dependency or schema migration by default.

Implement all applicable root/www surfaces consistently, including owner/admin,
customer/women and staff views. Cover German/English/Arabic text, RTL, keyboard
access, responsive layouts, stale requests, session changes and error recovery.
Client-side checks are never the authorization boundary. Validate ownership and
membership from persisted server state; do not trust caller role or salon ids.

Test positive, denied-role, cross-salon, invalid-input and relevant concurrent
cases in isolated fixtures. Review test imports/network behavior before adding
coverage to automated runners. Use explicit intercepted browser modes; no live
services or production credentials. Passing mocks do not prove SQL concurrency.

Run safe tests, static/parity and full type checks; record failures and gaps.
Review via salo-review, update knowledge/status/backlog, and leave the slice for
review. Schema/data changes, onboarding consent cutovers and infrastructure need
separate explicit approval. Never migrate, deploy, commit or push as a side effect.
