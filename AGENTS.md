# Infinite Canvas Collaboration Rules

## Start Here

Before editing, read `HANDOFF.md`, `GOALS.md`, `PROJECT_MEMORY.md`, `SPEC.md`, `PLAN.md`, `STATUS.md`, and `DECISIONS.md`. Then inspect the actual code, `git status`, and current test results. Documentation may lag behind code.

## Shared Workspace

- The accepted delivery baseline is committed on `codex/infinite-canvas`. The worktree may become dirty during later tasks; never reset, checkout, or revert unrelated changes.
- The current local app is served at `http://127.0.0.1:5182/`; the API uses port `3102`. Do not occupy ports `3000` or `5174`.
- The reference repository is at `C:/Users/Administrator/AppData/Local/Temp/basketikun-infinite-canvas-review`.
- The reference is AGPL-3.0. Use it as a behavioral and visual benchmark; do not blindly copy its source.
- Never place relay API keys in source, documentation, tests, screenshots, logs, or thread messages.

## Parallel Work Contract

### Execution Concurrency

- Keep the three pinned collaboration threads available and use additional bounded workers only for genuinely independent tasks.
- Activate one worker at a time by default. Use concurrent workers only when the user explicitly approves it for the current task.
- The user allows up to 10 concurrent workers/subagents. Do not create workers merely to reach that number, and obey the smaller runtime concurrency limit when the platform exposes fewer slots.
- Collaboration threads use `gpt-5.6-luna` with `xhigh` reasoning (user wording: "超高") unless the user explicitly overrides those settings.
- When concurrency is reduced, extra workers must stop after safely closing temporary browsers and clearing any test-only data they created.

Each worker owns exactly one implementation file and one status file:

- Shell worker: `src/styles/canvas-shell-reference.css` and `coordination/STATUS-shell.md`
- Controls worker: `src/styles/canvas-controls-reference.css` and `coordination/STATUS-controls.md`
- Nodes worker: `src/styles/canvas-nodes-reference.css` and `coordination/STATUS-nodes.md`

Do not edit another worker's implementation or status file. Do not edit `src/App.tsx`, `src/styles.css`, or `src/main.tsx` unless the main acceptance thread explicitly asks for it.

## Progress Reporting

Update the assigned status file immediately when starting, approximately every two minutes while actively working, and once more when complete. Each update must include time, completed work, next action, blockers, and verification evidence.

## Verification

Run focused checks during implementation. Before declaring completion, run:

```powershell
npm.cmd run build
npm.cmd test
git diff --check
```

The main acceptance thread owns final browser screenshots, responsive checks, console inspection, and merge acceptance.

## Completed Relay Migration Boundary

The user-owned image-key migration completed on 2026-07-31. The following ownership boundaries are retained only as historical recovery context and must not be treated as an active assignment:

- Backend worker: `server/app.js` only.
- Frontend worker: `src/App.tsx` only.
- Tests worker: `tests/server.test.mjs` only.
- Main thread: coordination, `src/api.ts`, environment/deployment docs, project memory/status/decisions, integration, and final acceptance.

Do not reopen or replace the accepted fixed-endpoint, user-owned-key, zero-site-charge image contract unless a new user request or a verified defect creates a new recoverable goal. New work must take its ownership boundaries from the current goal and status files.
