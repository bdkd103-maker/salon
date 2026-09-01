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
This project is a lightweight static web app. Prefer focused edits to HTML, CSS, and front-end behavior only. Avoid introducing new build tooling or heavy infrastructure unless the user explicitly requests it.
