# Infinite Canvas Collaboration Rules

## Start Here

Before editing, read `HANDOFF.md`, `GOALS.md`, `PROJECT_MEMORY.md`, `SPEC.md`, `PLAN.md`, `STATUS.md`, and `DECISIONS.md`. Then inspect the actual code, `git status`, and current test results. Documentation may lag behind code.

## Shared Workspace

- The accepted delivery baseline is committed on `codex/infinite-canvas`. The worktree may become dirty during later tasks; never reset, checkout, or revert unrelated changes.
- The current local app is served at `http://127.0.0.1:5182/`; the API uses port `3102`. Do not occupy ports `3000` or `5174`.
- The reference repository is at `C:/Users/Administrator/AppData/Local/Temp/basketikun-infinite-canvas-review`.
- The reference is AGPL-3.0. Use it as a behavioral and visual benchmark; do not blindly copy its source.
- Never place a user's text, image, or video relay key, an administrator password, ciphertext, an Authorization header, or a recoverable secret fragment in source, documentation, tests, screenshots, logs, or thread messages.

## Parallel Work Contract

### Execution Concurrency

- Keep only the current commander/main thread pinned. Collaboration and subagent threads must remain unpinned unless the user explicitly changes this preference.
- Activate one worker at a time by default. Use concurrent workers only when the user explicitly approves it for the current task.
- The user allows up to 10 concurrent workers/subagents. Do not create workers merely to reach that number, and obey the smaller runtime concurrency limit when the platform exposes fewer slots.
- Collaboration threads use `gpt-5.6-sol` with `ultra` reasoning unless the user explicitly overrides those settings.
- When concurrency is reduced, extra workers must stop after safely closing temporary browsers and clearing any test-only data they created.
- The 2026-08-01 interaction and three-user-key migration had an explicit user-approved exception for concurrent workers with non-overlapping ownership. That exception ended with local acceptance and is not standing permission for future goals.

The following ownership table is historical context for the completed visual-alignment goal, not a standing assignment:

- Shell worker: `src/styles/canvas-shell-reference.css` and `coordination/STATUS-shell.md`
- Controls worker: `src/styles/canvas-controls-reference.css` and `coordination/STATUS-controls.md`
- Nodes worker: `src/styles/canvas-nodes-reference.css` and `coordination/STATUS-nodes.md`

For each new multi-worker goal, define current file ownership before editing and do not overlap another active worker. Do not infer present ownership from the archived visual table.

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

## Completed Three-Key Relay Contract

The local three-user-key migration and commander browser acceptance completed on 2026-08-01. At this checkpoint the work is still unstaged, uncommitted, unpushed, and undeployed.

- Text, image, and video runtime authentication uses the authenticated user's own encrypted key for that relay kind.
- The server and administrator manage three independent relay addresses and open-model lists; they do not manage shared runtime keys.
- Account Security contains exactly three user-key controls and exposes no relay endpoint.
- Text model discovery uses the authenticated administrator's saved user text key. Administrator tests use that administrator's saved key for the corresponding relay kind.
- Text and video retain site-point accounting; image generation remains zero site points.
- Legacy shared-key columns remain only for additive schema compatibility and migration safety. They are not runtime credential sources.

## Historical Relay Migration Boundary

The user-owned image-key migration completed on 2026-07-31. The following ownership boundaries are retained only as historical recovery context and must not be treated as an active assignment:

- Backend worker: `server/app.js` only.
- Frontend worker: `src/App.tsx` only.
- Tests worker: `tests/server.test.mjs` only.
- Main thread: coordination, `src/api.ts`, environment/deployment docs, project memory/status/decisions, integration, and final acceptance.

The fixed image endpoint and image-only scope of that historical contract were superseded by the current three-key contract above. `AI_IMAGE_BASE_URL` remains a server fallback/default, not an account-displayed endpoint or a shared-key mechanism. New work must take its ownership boundaries from the current goal and status files.
