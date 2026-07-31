# Infinite Canvas Goals

> This file is the recoverable execution ledger for accepted ideas.
> Last update: 2026-07-31, Asia/Shanghai.
> User's latest explicit instruction overrides this file. Never store secrets here.

## Goal Workflow

When an idea has been accepted for implementation:

1. Create an active goal before editing.
2. Record observable success criteria and bounded steps here.
3. The main thread acts as commander and delegates independent implementation to the three collaboration threads.
4. Each worker reports completed work, next action, blockers, and verification evidence.
5. The commander reviews actual diffs, integrates cross-file contracts, and performs final acceptance.
6. Mark a goal complete only after implementation, automated checks, security review, browser acceptance when relevant, and status/document updates are all complete.

## Completed Goal: User-Owned Image Relay Key

- Status: complete
- Started: 2026-07-31
- Completed: 2026-07-31 17:58 +08:00
- Commander thread: current main acceptance thread
- Objective: migrate image generation to the later user-confirmed scheme. Lock the image relay to `https://www.bkbk.baby/`, store each user's image API key encrypted on the server, let the relay account handle image charges, and do not charge site points for image generation. Preserve text and video behavior.

### Success Criteria

- The browser never chooses or submits a relay base URL for image generation.
- The server calls `https://www.bkbk.baby/v1/images/generations` or `/images/edits` only.
- Each user can save, test, replace, and clear only their own image API key.
- API responses expose only `imageApiKeyConfigured`, never key material.
- Image generation and image edits use the authenticated user's key.
- Successful, failed, retried, and cached image requests do not change site balance or ledger entries.
- Request-key idempotency and content-conflict detection remain enforced.
- Text and video relay configuration and billing remain unchanged.
- No real relay key appears in source, docs, tests, logs, screenshots, or thread messages.

### Cross-Thread API Contract

- `GET /api/me`: user includes `imageApiKeyConfigured: boolean`.
- `PUT /api/me/image-key`: body `{ apiKey }`; saves encrypted key and returns configured status, fixed endpoint, and models.
- `DELETE /api/me/image-key`: clears the authenticated user's key.
- `POST /api/me/image-key/test`: body `{ apiKey?: string, model?: string }`; tests a temporary key without saving it, or the saved key when omitted.
- Internal image API base: `https://www.bkbk.baby/v1`.
- User-facing fixed endpoint label: `https://www.bkbk.baby/`.

### Steps

| Step | Owner | Status | Verification |
| --- | --- | --- | --- |
| Confirm existing schema, routes, UI, billing, and test surface | Commander | complete | `users.image_api_key_encrypted` and current image path inspected |
| Implement user key routes, fixed endpoint, user-key image calls, and zero site charge | Backend worker | complete | Full suite covers routes, encryption, fixed URLs, retries, cache, conflicts, and zero balance/ledger changes |
| Add account key controls and remove administrator image-key/point controls and charge wording | Frontend worker | complete | Build passed; desktop/mobile browser checks passed |
| Replace shared-image billing tests with encryption, isolation, fixed endpoint, zero charge, idempotency, and failure coverage | Tests worker | complete | `npm.cmd test` passed 18/18 |
| Update API types, environment/deployment docs, memory, decisions, and handoff | Commander | complete | Obsolete-scheme scan and secret-boundary review completed |
| Review all worker diffs and resolve cross-file mismatches | Commander | complete | Manual contract review completed against current code |
| Run `npm.cmd run build`, `npm.cmd test`, and `git diff --check` | Commander | complete | Build passed; 18/18 tests; diff check passed |
| Inspect browser account settings, image-node wording, admin panel, console, and failed requests | Commander | complete | Isolated desktop/mobile evidence; real draft untouched |
| Update `STATUS.md`, this file, and long-term decisions; complete the active goal | Commander | complete | Documents updated; isolated APIs and temporary data removed; real `3102/5182` health checks passed |

### Current Blockers

- None. The real canvas-version conflict was avoided by using isolated acceptance instances, and the real browser draft was not changed.

### Recovery Instructions

After a restart, do not reconstruct history. Read `GOALS.md`, `PROJECT_MEMORY.md`, `STATUS.md`, `DECISIONS.md`, the three worker threads/status files, `git status`, and the actual diffs. This goal has no incomplete step; create a new recoverable goal for the next accepted idea and preserve all unrelated dirty-worktree changes.

## Completed Goal: Delivery Maintenance Audit

- Status: complete
- Started: 2026-07-31
- Completed: 2026-07-31 20:37 +08:00
- Commander thread: current main acceptance thread
- Objective: audit the current dirty worktree for delivery-impacting defects in user-owned image keys, text/video relay behavior, deployment configuration, recovery documentation, and runtime gates. Fix only verified defects while preserving unrelated changes, the real browser draft, and ports `3102/5182`.

### Success Criteria

- Current code, tests, deployment examples, and handoff documents describe the same relay and billing contracts.
- Production environment examples cover every operationally relevant server limit and video setting used by the code.
- Image-key encryption, fixed endpoints, zero site charges, and text/video independence remain intact.
- Stale status or active-contract wording cannot send a replacement AI back into completed work.
- Build, full tests, focused production checks, `git diff --check`, secret review, and real `3102/5182` health checks pass.
- No unrelated dirty-worktree changes or real browser drafts are reset, overwritten, or cleaned.

### Steps

| Step | Owner | Status | Verification |
| --- | --- | --- | --- |
| Establish the current code, deployment, test, and documentation baseline | Commander | complete | Git state, required project files, worker threads, ports and current diffs inspected |
| Audit deployment/environment coverage | Deployment audit worker | complete | Video/media variables, Nginx upload limit, JWT lifecycle and backup-path risks identified |
| Audit frontend/backend relay parity and preserved video behavior | Relay audit worker | complete | Video UI regression, async quota failure and result-download SSRF identified against actual routes |
| Audit handoff, goal, and worker-status consistency | Documentation audit worker | complete | Active/finished goal, old visual plan, test-count and acceptance contradictions identified |
| Apply and verify evidence-backed fixes | Commander | complete | Frontend video chain, deployment examples, backup path protection, strict restore decryption, async 413 refund, controls fixes and SSRF protection/tests landed |
| Run final gates and close the audit | Commander | complete | Build passed; full tests 20/20; production checks 6/6; both Node syntax checks, diff check and 39-file secret scan passed; only real `3102/5182` listen and return HTTP 200 |

### Completion Notes

- Workers use `gpt-5.6-luna` with `xhigh` reasoning (user wording: "超高"). Activate one worker at a time by default; higher concurrency requires the user's explicit approval for the current task and remains subject to the runtime limit.
- The worktree is intentionally dirty; never reset, checkout, clean, or overwrite unrelated changes.
- Do not open or mutate the real browser draft while auditing.
- Isolated desktop/mobile acceptance and document synchronization are complete. The isolated browser tab is closed, the viewport override is reset, `3103/3113` are stopped, `.codex-acceptance` is removed, and only real `3102/5182` remain.
- The Git runtime's Bash successfully parsed `deploy/install.sh`, `deploy/backup.sh` and `deploy/restore.sh` with `bash -n`. Docker is not installed on this Windows host, so container/Nginx/Certbot execution remains a deployment-host verification rather than a local test.
- Residual risk: video DNS/IP validation occurs before the actual fetch connection, leaving a DNS-rebinding TOCTOU window. The exact-origin allowlist, unsafe-address rejection, manual redirect validation and authorization-header isolation remain in force.

### Recovery Instructions

This goal has no incomplete step. On restart, inspect the current Git state and documents, preserve all dirty-worktree changes and the real browser draft, and create a new recoverable goal only after the user confirms a new idea for execution.

## Completed Goal: One-Click Deployment and GitHub Push

- Status: complete
- Started: 2026-07-31
- Completed: 2026-07-31 21:14 +08:00
- Commander thread: current main thread
- Objective: add a safe, repeatable one-command Ubuntu/Debian deployment path, validate it against the current production contract, commit the complete accepted worktree and push the current `codex/infinite-canvas` branch to `https://github.com/bykedie/huabu.git`.

### Success Criteria

- A documented one-line command installs dependencies, clones or fast-forwards the intended branch, creates secure first-run configuration, starts Compose, configures Nginx and optionally obtains HTTPS.
- Re-running deployment preserves `.env` and the Docker data volume, rejects dirty/divergent repositories and backs up a running deployment before applying a fast-forward update.
- No generated secret, database or backup is added to Git or echoed by the deployment script.
- Deployment tests, build, full tests, syntax/diff/secret checks and real local service health pass.
- All intended files are reviewed, committed and pushed to the configured GitHub remote without force-pushing.

### Steps

| Step | Owner | Status | Verification |
| --- | --- | --- | --- |
| Inspect remote, branch and current deployment contract | Commander | complete | `origin` and Docker/Nginx/backup files inspected |
| Implement installer, one-line command and deployment contract test | Commander | complete | Installer and README command added; focused production suite passed 7/7; three shell scripts passed `bash -n` |
| Run deployment-focused and complete gates | Commander | complete | Build passed; full tests 21/21; production checks 7/7; three shell scripts, Node syntax, diff and secret checks passed |
| Review, commit and push current branch | Commander | complete | 35 intended files committed as `d5006e0` and pushed without force; remote installer returned HTTP 200 and matched the committed local file exactly |

### Completion Notes

- Delivery branch: `codex/infinite-canvas`.
- GitHub repository: `https://github.com/bykedie/huabu.git`.
- Main delivery commit: `d5006e0` (`feat: complete relay migration and deployment workflow`).
- Public installer URL: `https://github.com/bykedie/huabu/raw/refs/heads/codex/infinite-canvas/deploy/install.sh`; verified as `200 text/plain`, with content identical to the committed installer.
- No force push was used. `.env`, database, backup, log and generated build files were excluded from the commit.

### Recovery Instructions

This goal has no incomplete implementation or push step. Start the next accepted idea as a new recoverable goal, inspect the current Git state first, and preserve the real browser draft and running `3102/5182` services.

## Active Goal: Public-Port Deployment and `h` Management Panel

- Status: active
- Started: 2026-07-31
- Commander thread: current main thread
- Objective: make first deployment usable through public IP plus port without requiring a domain, and add a terminal management panel launched with `h` for ongoing configuration, operations, backup/recovery and optional domain/HTTPS setup.

### Success Criteria

- Compose defaults to `0.0.0.0:3102` while allowing a validated configurable host bind and port without changing the container port.
- The one-line installer succeeds without domain arguments, preserves existing secrets/data, reports the public IP URL, warns that HTTP is not encrypted and safely installs the `h` command.
- Domain and HTTPS remain an optional later upgrade and a certificate failure cannot damage the working IP/port deployment.
- `h` provides actionable status, service, update, port, domain/HTTPS, relay, commercial/quota, backup/restore, log/diagnostic and administrator-bootstrap controls without displaying stored secrets.
- Shell syntax, focused deployment tests, full tests, build, diff/secret checks and real local health checks pass before a normal GitHub push.

### Ownership

| Surface | Owner | Status |
| --- | --- | --- |
| `deploy/manage.sh` | Shell collaboration thread / commander integration | complete |
| `deploy/install.sh` | Controls collaboration thread / commander integration | complete |
| `tests/production-config.test.mjs` | Nodes collaboration thread / commander integration | complete |
| Compose/env/docs/integration/acceptance/push | Commander | in progress |

### Current Evidence

- `npm.cmd run build`: passed.
- `npm.cmd test`: 21/21 passed.
- `node --test tests/production-config.test.mjs`: 7/7 passed.
- `bash -n deploy/install.sh deploy/manage.sh deploy/backup.sh deploy/restore.sh`: passed.
- `node --check server/app.js` and `node --check server/check-db.js`: passed.
- `git diff --check`: passed with existing LF-to-CRLF warnings only.
- Docker is unavailable on this Windows workstation; actual Ubuntu/Debian Compose, Nginx, Certbot and UFW execution remains a deployment-host verification.
