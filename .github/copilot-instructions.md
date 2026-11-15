# Copilot Project Instructions

## Operating principles
- Be conservative, minimal, and safe.
- Prefer small, readable patches over broad refactors.
- Only modify files inside this repository.
- Do not touch system-level resources, developer environment, or global packages.
- If a task could affect deployment, credentials, or external infrastructure, stop and ask before proceeding.

## Safety constraints
- No `sudo`, no destructive shell commands, and no commands that modify the host beyond the repository.
- No changes to credentials, secrets, SSH keys, shell configuration, or OS settings.
- No broad cleanup or unrelated code churn.
- No unreviewed dependency upgrades or environment changes.

## Workflow
1. Read the relevant files first.
2. Investigate the root cause before changing code.
3. Keep the fix scoped to the bug or requested feature.
4. Validate with the smallest local command that checks the behavior.
5. Present the result clearly, including limits and risks.

## Repository-specific guidance

SALO SMART SALON is a multi-salon booking, queue, and salon management platform.

Technology stack:
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, TypeScript, Fastify
- Database: PostgreSQL with Prisma ORM
- Mobile: Capacitor for Android and iOS
- Version control: Git and GitHub

Development rules:
- Preserve the existing architecture and completed features.
- Work on one clearly defined task at a time.
- Investigate the root cause before modifying code.
- Keep modifications minimal and strictly within scope.
- Never access, modify, or expose secrets or credentials.
- Never commit, push, deploy, or publish without explicit user approval.
- Never delete, reset, or overwrite existing work.
- Do not run destructive cleanup commands.
- Do not modify unrelated files.
- Run relevant tests when applicable.
- Report changed files, validation results, limitations, and risks.
- Request approval before database migrations, dependency upgrades, or infrastructure changes.
