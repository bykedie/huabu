# Infinite Canvas Collaboration Rules

## Start Here

Before editing, read `HANDOFF.md`, `GOALS.md`, `PROJECT_MEMORY.md`, `SPEC.md`, `PLAN.md`, `STATUS.md`, and `DECISIONS.md`. Then inspect the actual code, `git status`, and current test results. Documentation may lag behind code.

## Goal Mode and New Session Takeover

- The user prefers Codex goal mode for non-trivial project execution. Before editing, get the current goal and create or resume a recoverable goal with observable success criteria, bounded steps, blockers, and verification evidence.
- A user statement such as `你去看一下项目的交接文档` or `现在这个项目由你来接管` is explicit authorization to create a project-takeover audit goal.
- A new session restores state from this repository, the actual worktree, fresh tests, and running services. Do not read, fork, or recover old Codex thread IDs unless the user explicitly asks for that exact operation.
- If the user requests takeover without a concrete implementation task, the first turn is read-only project intake: read the recovery documents, inspect Git/code/tests/ports, report the current state, and wait for the next task. Do not inspect images, open a browser, start servers, or implement features in that intake turn.
- Keep `GOALS.md`, `PLAN.md`, `STATUS.md`, and the relevant coordination status synchronized during long tasks. Mark a goal complete only after all required implementation, verification, browser acceptance, documentation, and fixture cleanup are actually complete.

## Continuous Handoff Checkpoint Protocol

- An on-disk handoff checkpoint is mandatory in two cases: after every goal reaches completion, before reporting or marking it complete; and before continuing into any task or next phase that may exceed the current context window. If there is reasonable doubt that the next phase fits, write the checkpoint first.
- Chat messages, tool goal state, and an in-memory plan do not replace the checkpoint. A replacement session must be able to resume from repository files without the preceding conversation.
- Write the canonical live checkpoint to the relevant `coordination/STATUS-<goal>.md`, then synchronize the current summary in `GOALS.md`, `PLAN.md`, and `STATUS.md`. Update `HANDOFF.md`, `PROJECT_MEMORY.md`, or `DECISIONS.md` when the authoritative project state, a durable preference, or a durable decision changed.
- Every checkpoint must explicitly record: current goal, completed work, unfinished work, latest verification results, modified files, exact next action, and concrete recovery commands. Recovery commands must include the workspace path and read-only state inspection before any mutation; never include secrets or destructive commands.
- A mid-goal context checkpoint leaves the goal active and describes unfinished work precisely. A final checkpoint records all gates and cleanup, and must exist before the goal is marked complete or the final response is sent.

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
- The user allows at most 3 concurrent workers/subagents. Do not exceed this limit unless the user explicitly changes it again, do not create workers merely to reach it, and obey any smaller runtime concurrency limit exposed by the platform.
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

## Screenshot Review Limit

- Review at most one user-provided original screenshot per turn and call an image-viewing tool at most once in that turn. This is a context-size limit, not a per-image authorization gate.
- Do not create or inspect crops, composites, enlargements, thumbnails, or other derived versions of the screenshot.
- After completing the single screenshot analysis, end that turn without implementation, browser work, server startup, or inspection of another image.
- The turn boundary exists only to keep image context bounded. If the active goal still has pending original screenshots, a later continuation turn may automatically review the next one; do not wait for a fixed phrase such as `看下一张` or treat repeated user permission as a prerequisite. Stop only when the user pauses, redirects the goal, or no screenshot remains pending.

## Verification

Run focused checks during implementation. Before declaring completion, run:

```powershell
npm.cmd run build
npm.cmd test
git diff --check
```

The main acceptance thread owns final browser screenshots, responsive checks, console inspection, and merge acceptance.

## Completed Three-Key Relay Contract

The three-user-key migration and commander browser acceptance completed on 2026-08-01 and were later delivered to GitHub. This section preserves the current relay contract, not the latest Git or production deployment state; use `HANDOFF.md`, `STATUS.md`, and the actual Git state for that.

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

The fixed image endpoint and image-only scope of that historical contract were superseded by the current three-key contract above. Fresh deployments have no built-in image relay address; `AI_IMAGE_BASE_URL` is only an optional server environment fallback when explicitly set, not an account-displayed endpoint or a shared-key mechanism. New work must take its ownership boundaries from the current goal and status files.
