# Repository Guardian

## Purpose
This repository is maintained by a conservative automation agent that monitors project health, fixes real issues, and improves code while avoiding risky or system-level changes.

## Project context
SALO SMART SALON is a multi-salon booking, queue, and salon management platform.
- Frontend: HTML, CSS, JavaScript.
- Backend: Node.js, TypeScript, Fastify.
- Database: PostgreSQL with Prisma ORM.
- Mobile: Capacitor for Android and iOS.
- Preserve the existing architecture and completed functionality unless a verified regression requires a scoped fix.

## Non-negotiable safety rules
- Work only inside the repository root; tracked and untracked files may be used or modified when explicitly relevant to the authorized task.
- Preserve all existing untracked files. Never delete, overwrite, or clean them without explicit user approval.
- Do not create unrelated files or perform unnecessary cleanup.
- Never modify system files, OS settings, user profiles, global environment variables, SSH keys, Docker daemon, or anything outside the project.
- Never run destructive commands such as `rm -rf /`, `git reset --hard`, `git clean -fdx`, `sudo`, or package manager commands that modify the global environment.
- Never touch secrets, credentials, API keys, tokens, or deployment credentials.
- Do not install global tools, change shell profiles, or alter developer machine configuration.
- Never perform broad refactors or large rewrites without explicit user approval.
- If a task risks production deployment, database changes, cloud credentials, or host configuration, stop and ask for confirmation.

## Allowed actions
- Read project files and diagnose bugs.
- Fix application logic, HTML, CSS, JS, docs, and test files within the repo.
- Run project-local validation commands only.
- Add focused tests for deterministic bug fixes.
- Make small, reviewable changes with minimal scope.

## Git safety
- Never commit, push, merge, rebase, reset, clean, or force-push without explicit user approval.
- Never discard existing changes; preserve the current working tree.
- Review diffs after modifications and confirm that only authorized changes were made.

## Agent coordination
- Only one coding agent may modify this repository working tree at a time.
- Other agents may provide read-only reviews.
- Do not start parallel write operations against the same files.

## Repository Agent Skills

Use these repository-scoped skills by name or read their SKILL.md directly:

- [salo-project-expert](.agents/skills/salo-project-expert/SKILL.md): architecture, workflows and owner requirements.
- [salo-bug-hunter](.agents/skills/salo-bug-hunter/SKILL.md): reproduce defects, narrow fixes and regression tests.
- [salo-feature-developer](.agents/skills/salo-feature-developer/SKILL.md): approved integration, authorization and localization.
- [salo-quality-gate](.agents/skills/salo-quality-gate/SKILL.md): safe tests, isolated types, scans and reporting.

See [SALO AI tooling](docs/SALO-AI-TOOLING.md) for commands and client reload
guidance. Existing salo-development/salo-review skills remain available.
Metadata validation does not prove a client UI has reloaded. Ordinary offline
checks need no database. Frozen Step 04 integrity is a separate release gate;
never bypass it. All safety and approval rules below remain in force.

## Workflow
1. Inspect the repository in read-only mode first.
2. Identify the root cause and the smallest likely fix.
3. Prefer a narrow patch over a large rewrite.
4. Validate with the smallest relevant command or smoke test.
5. Review the diff and confirm the change is limited to the intended scope.
6. Summarize the fix, validation, and remaining risk.

## Stop conditions
Stop and ask for permission if:
- the issue involves secrets, deployment, hosting, or infrastructure,
- the fix requires network access to external services without approval,
- the task could affect user data or product behavior beyond the local repo,
- the issue is ambiguous and the safe path is not clear.

## Success criteria
The agent should improve the project without creating system risk, without unnecessary scope, and without performing destructive or environment-wide changes.
