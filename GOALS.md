# Infinite Canvas Goals

> This file is the recoverable execution ledger for accepted ideas.
> Last update: 2026-08-02, Asia/Shanghai.
> User's latest explicit instruction overrides this file. Never store secrets here.

## Completed Goal: AI Creation Context and Canvas Node Interaction

- Status: GitHub delivery complete; production undeployed
- Started: 2026-08-02 10:55 +08:00
- Commander thread: current main thread
- Baseline: local and `origin/codex/infinite-canvas` at `77e8ceff63c49f9930e73bdb4f45cc6d9573e20a`; worktree clean at start
- Concurrency: one worker at a time; no concurrent-worker exception has been approved for this goal
- Objective: align the canvas `AI 创作` node with the local AGPL reference repository as a behavioral and visual benchmark, make connected text and image nodes supply correctly typed generation context, unify the product font, fix image toolbar and resize behavior, improve node dragging, and let the top-right import action accept images through the existing image-node persistence path.

### Success Criteria

- `AI 创作` has a compact, coherent configuration surface and interaction rhythm based on the reference behavior without copying its source. Text/image/video modes, prompt, model and media settings remain usable on desktop and mobile.
- Incoming connected text or note nodes contribute readable prompt/context text. Incoming connected image nodes contribute image references. Internal URLs, `data:` payloads and unrelated node fields are never inserted into visible prompts.
- Image and video generation receive the same typed context contract where applicable; text generation receives textual context without attempting to submit image payloads to the text relay.
- The global UI uses one locally available system font stack with good Chinese and Latin rendering; no remote font dependency is introduced.
- A generated or uploaded image node keeps its image inside the node during resize, preserves the configured aspect-ratio behavior, and never exposes an internal `data:` URL input.
- The image quick toolbar is anchored above its own image node and cannot jump to the application top edge or overlap unrelated controls.
- Text, note and AI creation nodes have an obvious, sufficiently large drag surface while form controls remain editable and do not accidentally drag the node.
- The top-right import action accepts both canvas draft JSON and one or more images. Images use the existing compression, node creation, autosave and draft compatibility paths.
- Focused regressions, `npm.cmd run build`, `npm.cmd test`, `git diff --check`, desktop/mobile browser acceptance, responsive checks and console/network inspection pass before completion.

### Current Steps

| Step | Status | Evidence |
| --- | --- | --- |
| Restore project state and record the goal | complete | Required documents, coordination files, Git state and current code inspected; baseline worktree is clean at `77e8cef` |
| Inspect five user screenshots and the reference implementation one item at a time | complete | Screenshots 1-5 were reviewed one original image per turn; no derived image was created or inspected |
| Add focused regression coverage | complete | `tests/ai-creation-contract.test.mjs` passes `10/10`, covering typography, typed context, relay payloads, import classification, ready-image URL hiding, resize modes, drag handles, AI hierarchy, toolbar anchoring, dock avoidance and pointer isolation |
| Implement scoped canvas and style changes | complete | Typed context, unified fonts, image-aware top import, compact AI card, ready-image rendering, eight-way resize, dedicated drag handles and node-local clamped image tools are implemented |
| Run automated and browser acceptance | complete | Full `50/50`, build, diff, desktop `1440x1000`, default `1280x720`, mobile `390x844`, typed connection, drag, pan, zoom, resize, toolbar-scroll and clean-console checks passed |
| Synchronize recovery documents and delivery state | complete | Root and coordination documents record the final local evidence and distinguish local completion from GitHub delivery and production deployment |
| Commit and push GitHub delivery | complete | Feature commit `ca6ed672541b70c357edc5acd9cbbd84a1f43ddb` was pushed normally to `origin/codex/infinite-canvas`; production was not touched |

### Recovery Instructions

This goal is complete on GitHub. Resume only from `STATUS.md`, `PLAN.md`, `coordination/STATUS-ai-creation.md`, the current Git state and fresh tests; there are no pending screenshots for this goal. Preserve the real browser draft, `.env`, SQLite data, Docker volumes, relay keys and `/srv/canvas-backups`. The one-original-image-per-turn rule remains a context-size limit for future image-review goals, not an authorization gate. Production deployment remains a separate user-directed action.

## Active Goal: Web-Only Relay Setup, Model Discovery, and No-Billing UX

- Status: complete; GitHub delivery complete, production update pending
- Started: 2026-08-02 00:04 +08:00
- Commander thread: current main thread
- Baseline: local and `origin/codex/infinite-canvas` both at `11f6fa8312c8610df38924be0276b6364fc1f606`; worktree was clean at start
- Concurrency: the user approved concurrent work for this goal but capped active subthreads at 3; this cap overrides older 10-worker history
- Objective: make the web administrator panel the only normal relay-configuration surface, discover and explicitly select text/image/video models from upstream, support Responses-first text generation, temporarily disable site-point charging and hide point/recharge surfaces, move the API-key entry to the former top-right points position, and repair canvas renaming.

### Success Criteria

- `h` no longer displays or dispatches text/image/video relay configuration entries; safe update remains item 5.
- Operations can fetch `/models` for text, image, and video with the current administrator's corresponding saved user key. A new fetch replaces the candidate list and clears old selections instead of preserving preset checks.
- Text relay calls `/responses` first, parses `output_text` or nested output text, and falls back to `/chat/completions` only for upstream 404/405. Text nodes and Agent share the same behavior.
- Fresh configuration contains no built-in text or image model selection. Models become user-visible only after an administrator discovers, selects, and saves them.
- Site billing defaults off for this release. New text/video calls reserve and charge zero site points while preserving generation idempotency, failure state, secret-reflection protection, and future billing code.
- The top-right former balance button opens Account Security and is labeled as the API-key entry. Balance, wallet, redeem, recharge request, redeem-code generation, recharge review, and point wording are not reachable in the web UI while billing is disabled.
- Canvas naming works with a visible single-click/touch edit action and persists after save/reload.
- Focused regressions, full tests, build, syntax, diff, secret scans, desktop/mobile browser acceptance, commit, and normal GitHub push pass before completion.

### Current Steps

| Step | Status | Evidence |
| --- | --- | --- |
| Inspect screenshots, current implementation, reference behavior, Git and status files | complete | Both screenshots reviewed one at a time; current text-only discovery merge, fixed Chat Completions path, h relay entries, point UI, and double-click-only rename were located |
| Add recovery status and regression tests | complete | Added focused relay modernization and web/deployment contract suites; both focused files pass `4/4` |
| Implement backend protocol, discovery, and no-billing behavior | complete | Three-kind model discovery, Responses-first text calls, 404/405-only fallback, empty model defaults, and opt-in billing compatibility are implemented |
| Implement administrator/account/header/rename UI | complete | Operations supports three discovery/checklist flows; the top-right API-key entry, hidden billing UI, and click/touch/Enter rename behavior passed browser acceptance |
| Remove h relay entries and synchronize deployment contract | complete | `h` now has 14 items, safe update remains item 5, and relay configuration is web-only |
| Run automated, browser, security, and documentation gates | complete | Full `40/40`, build, Node/Shell syntax, diff, secret scan, desktop `1440x1000`, and mobile `390x844` acceptance passed; isolated fixtures were removed |
| Commit and push GitHub delivery | complete | Feature delivery commit `99926be16bf561cfdb1ddfe4d51eb6ce4d7936e4` was pushed normally to `origin/codex/infinite-canvas`; local and remote full SHA matched before the final documentation-only closeout |

### Recovery Instructions

This goal is complete on GitHub. Resume production work only from `STATUS.md`, `HANDOFF.md`, `coordination/STATUS-text-models.md`, and the actual Git state. Preserve `.env`, SQLite data, Docker volumes, user canvases, relay keys, and `/srv/canvas-backups`. Never copy a real relay key into source, tests, docs, logs, screenshots, or commands. Production updates remain user-operated through MobaXterm item 5.

## Goal Workflow

When an idea has been accepted for implementation:

1. Create an active goal before editing.
2. Record observable success criteria and bounded steps here.
3. The main thread acts as commander and delegates bounded implementation to one worker at a time unless the user explicitly approves concurrency for that round.
4. Each worker reports completed work, next action, blockers, and verification evidence.
5. The commander reviews actual diffs, integrates cross-file contracts, and performs final acceptance.
6. Mark a goal complete only after implementation, automated checks, security review, browser acceptance when relevant, and status/document updates are all complete.

## Prior Goal: Production Interaction, Relay, and Agent Repair

- Status: GitHub delivery complete; production update pending
- Started: 2026-08-01 18:48 +08:00
- Commander thread: current main thread
- Objective: repair the production HTTP interaction blackout and canvas shell, correct the Agent panel, replace the legacy shared-key relay contract with three per-user keys, add text/image/video administration and upstream text-model discovery, expose the selected text models to Agent chat and text-generation nodes, then verify, deliver, and update production without losing data or secrets.

### Success Criteria

- Public HTTP does not depend on `crypto.randomUUID`; creating canvases and using every Dock/sidebar action produces no uncaught exception, black page, or frozen shell.
- The real "我的画布" list renders, and the hamburger/sidebar can be opened and closed repeatedly on desktop and mobile.
- The Agent panel header, model selector, messages, and composer are fully visible and usable without overlap.
- Operations contains text, image, and video relay configuration. Administrators configure relay addresses and open models, not shared API keys.
- Text operations can fetch the upstream model list using the authenticated administrator's own saved text key, then choose which models are open.
- Account Security contains exactly three transient password inputs for the user's text, image, and video keys; it does not display relay endpoints or return key material.
- Agent chat and canvas text-generation nodes let the user select an administrator-opened text model and send that model to the server.
- Existing text/video point accounting and image zero-site-point behavior remain intact; all three user keys are encrypted, isolated, migration-safe, and absent from logs, documents, localStorage, API responses, screenshots, and audit details.
- Build, full tests, focused production/deployment tests, syntax checks, diff check, desktop/mobile browser acceptance, and a real non-secure HTTP acceptance pass before GitHub and production delivery.

### Current Round

| Step | Status | Evidence |
| --- | --- | --- |
| Reproduce and map the production failures | complete | User screenshots show `crypto.randomUUID is not a function`, a broken Agent layout, missing image administration, malformed model text, and an unclosable sidebar |
| Repair UUID, Dock, canvas list, sidebar, and hamburger behavior | complete | UUID helper covers missing page-level `crypto`; desktop/mobile Dock, menu, sidebar, clear/undo, navigation, upload and appearance paths passed commander acceptance |
| Implement three-user-key storage and relay/model APIs | complete | Additive user text/image/video ciphertext columns, per-user runtime selection, address/model-only administrator APIs, model discovery, billing and reflection guards verified |
| Implement Operations, Account Security, Agent, and text-node UI | complete | Three key controls with zero endpoint fields, three Operations tabs, Agent and text-node model selection passed desktop/mobile browser acceptance |
| Run automated and browser acceptance | complete | Reflection 2/2; server 19/19; production 12/12; full 32/32; UUID 1/1; build/syntax/post-build/diff passed; `1440x1000`, `390x844`, and genuine HTTP acceptance complete |
| Synchronize durable recovery documents | complete | Nine owned documents now record the three-user-key contract, superseded history, current/origin/production SHA split, final automated/browser evidence, concurrency exception, cleanup, and pending delivery; scoped obsolete-contract/secret scans and diff check passed |
| Commit and push GitHub delivery | complete | Three-key migration was pushed as `fde4fb2`; relay-origin compatibility followed as `11f6fa8`; local and origin full SHA match `11f6fa8312c8610df38924be0276b6364fc1f606` |
| Update and accept production | pending | Production remains at `3f7b52d`; update only through the validated backup/fast-forward workflow and MobaXterm |

### Recovery Instructions

This prior goal has been delivered to GitHub. Resume only from the active goal at the top of this file, `STATUS.md`, and the actual Git diff. Do not reopen historical fixed-image/shared-text/shared-video contracts. Preserve `.env`, the database, Docker volumes, all user canvases, all relay secrets, and `/srv/canvas-backups`. GitHub delivery is not production deployment.

## Historical Goal: Four Access Modes and Server Image Relay

- Status: historical GitHub delivery complete; remaining production delivery is carried by the active goal above
- Started: 2026-08-01
- Commander thread: current main thread
- Objective: default a fresh deployment to detected public IP plus port, let `h` select public/domain/both/private, make the image relay address server-configurable while retaining user-owned keys, and deliver the verified result through GitHub without losing deployment state.

### Success Criteria

- Fresh install writes `MOYU_ACCESS_MODE=public`, binds `0.0.0.0`, detects a public IPv4 and prints `http://IP:port`.
- `h` displays and switches all four modes with health/Nginx rollback; repeat installs preserve explicit modes and infer old deployments safely.
- `AI_IMAGE_BASE_URL` is an HTTPS server setting; users still save isolated encrypted image keys, image calls charge zero site points, and administrator image keys remain absent.
- Build, full tests, focused deployment tests, four Shell and four Node syntax checks, diff check and secret review pass.
- Accepted files are committed and normally pushed to `origin/codex/infinite-canvas`; production is then updated only through the validated backup path.

### Current Round

| Step | Status | Evidence |
| --- | --- | --- |
| Implement access mode state and old-config migration | complete | `MOYU_ACCESS_MODE=public|domain|both|private`; bind and Nginx behavior mapped in installer/manager |
| Detect and display public IPv4 | complete | installer and `h status` query public IPv4 services and avoid presenting a private address as public |
| Make image relay server-configurable | complete | `AI_IMAGE_BASE_URL`, account display, HTTPS/credential/query/private-network checks and manual redirect policy implemented |
| Preserve user-owned image-key and zero-charge contract | complete | complete tests cover encryption, isolation, routes, generation/edit calls, cache/retry and unchanged balances |
| Run local gates | complete | build passed; full tests 24/24; deployment tests 10/10; Shell/Node syntax and diff checks passed |
| Synchronize recovery documents | complete | README, AGENTS, SPEC, PLAN, memory, handoff, decisions, goals and main status updated |
| Commit and push delivery | complete | `5fa5804` pushed normally to `origin/codex/infinite-canvas`; local and remote full SHA match |
| Update and accept production | superseded / carried forward | `3f7b52d` is still the current production SHA; all later CSP/root-credential/interaction/three-key delivery is tracked by the active goal above |

### Recovery Instructions

Start with `git status`, `git diff`, this goal and `STATUS.md`. Do not reconstruct from chat. Preserve `.env`, database, Docker volumes, relay keys and `/srv/canvas-backups`. Local completion is not production completion.

## Historical Goal: Restore `api.bkbk.baby` and Split Relay Management

- Status: superseded by the four-access-mode goal above; relay split and automatic HTTPS are complete, public host repair remains part of production acceptance
- Started: 2026-08-01
- Commander thread: current main thread
- Objective: restore public access through `api.bkbk.baby`, split the `h` relay configuration into independent text, image and video entries, deploy the accepted code safely, and verify the public application while preserving data, secrets and every existing backup.

### Success Criteria

- `h` exposes separate `配置文字中转`, `配置图片中转` and `配置视频中转` menu entries with correct routing and Chinese prompts.
- Historical criterion at the time: text and video used encrypted administrator configuration, while the image entry managed only `AI_IMAGE_MODELS` and kept a fixed endpoint. The active four-mode goal supersedes only that fixed-endpoint portion; user-owned encrypted keys remain unchanged.
- A rejected image-model change restores the previous `.env` and attempts to return the existing application to a healthy state. No database, Docker volume, `.env`, secret or backup is deleted or replaced.
- Build, full tests, focused deployment tests, Shell/Node syntax and diff checks pass before delivery.
- The accepted commits are pushed and production is updated only through the validated backup/fast-forward path.
- Public DNS resolves `api.bkbk.baby` to the actual ECS, HTTP redirects to HTTPS, the certificate matches the hostname, `https://api.bkbk.baby/api/health` returns 200, and the application opens normally.

### Current Round

| Step | Status | Evidence |
| --- | --- | --- |
| Diagnose the public-domain failure | complete | `api.bkbk.baby` is a CNAME to `bkbk.baby`, whose A record is `64.83.20.132`; the actual ECS is `116.62.191.104`. Forced HTTP to the ECS returns `403 Server: Beaver`, and forced HTTPS resets, so DNS and the ECS reverse proxy/certificate both require correction |
| Implement three independent relay entries | complete | `deploy/manage.sh` now routes menu items 8/9/10 to text/image/video independently; image configuration preserves the fixed endpoint and user-owned-key contract |
| Add documentation and deployment-contract tests | complete | README and focused tests cover menu labels/routing, image model persistence/rollback, fixed endpoint language and the absence of administrator image URL/key writes |
| Synchronize recovery documents and run final local gates | complete | Read-only audit completed; trailing empty image-model entries were fixed; build, full 23/23 tests, focused 9/9 tests, four Bash and four Node syntax checks, secret-boundary scan and diff check passed |
| Commit and push the accepted local change | complete | `80ba173` (`feat: split relay management entries`) was pushed normally to `origin/codex/infinite-canvas`; direct GitHub access failed, then the existing local proxy completed the non-force push |
| Make domain deployment automatic and reusable | complete | Domain mode now defaults to HTTPS with optional Let's Encrypt email, retains rollback behavior, and README documents a GitHub one-line domain deployment for the future server; build, 23/23 tests, 9/9 focused tests, Bash syntax and diff checks pass |
| Switch DNS and configure ECS Nginx/HTTPS | pending | High-impact production change requires explicit user confirmation immediately before execution; existing site state must be backed up and rollback retained |
| Deploy and complete public acceptance | pending | Verify production SHA, validated backup, healthy container, new 17-item `h` menu, HTTP redirect, certificate hostname, HTTPS health and rendered application |

### Recovery Instructions

Read `git status`, the current diff and `STATUS.md`; do not reconstruct this goal from chat history. The user has delegated the listening, reverse-proxy and certificate choices to the commander. Use loopback application binding plus Nginx HTTPS, and retain a reversible copy of existing site state before switching traffic. The local implementation is not equivalent to production completion. Never delete or expose `.env`, Docker volumes, databases, relay keys or anything under `/srv/canvas-backups`.

## Completed Goal: Production Backup Permission Compatibility

- Status: complete
- Started: 2026-08-01
- Completed: 2026-08-01
- Commander thread: current main thread
- Objective: recover the existing Ubuntu deployment, identify why the pre-update database gate reports `/backup/app.db` missing, make old deployments compatible without weakening backup privacy, verify the patch, push it, and safely retry the production update.

### Confirmed Facts

- The original failed update left production on `56e29a7`; it did not merge the fetched commits or replace the database.
- Production now runs `e261aeb`; the repository is clean and the app container is `running/healthy`.
- The live database is `/app/data/app.db` in the Compose `canvas-data` volume, with non-empty WAL and SHM sidecars.
- `docker compose cp -a app:/app/data/. <backup>/` produces the expected flat layout. The failure is permissions: `umask 077` creates the host backup directory as `0700 root:root`, while the validation container defaults to the unprivileged `node` user and cannot traverse `/backup`.
- A separate `0700` recovery backup was created under `/srv/canvas-backups` and passed `server/check-db.js` when the one-shot validation container ran as root. The old app was restarted and returned a healthy response afterward.

### Success Criteria

- Update-time, manual, candidate, and rollback database checks can read private root-owned maintenance directories without changing those directories to group/world-readable permissions.
- Restore writes database files back with the application runtime owner's UID/GID.
- Build, full tests, focused deployment tests, Shell/Node syntax and diff checks pass.
- The patch is committed and normally pushed to `origin/codex/infinite-canvas`.
- Production fast-forwards from `56e29a7`, creates and validates another pre-update backup, rebuilds successfully, and returns healthy with the existing database.

### Steps

| Step | Status | Evidence |
| --- | --- | --- |
| Recover old service and locate the database | complete | Compose reports the old app healthy; `/app/data/app.db`, WAL and SHM confirmed in the named volume |
| Reproduce the backup gate failure | complete | Default `node` maintenance container cannot traverse the `0700 root:root` backup bind; root maintenance container can |
| Create an independent validated recovery backup | complete | Private recovery directory retained under `/srv/canvas-backups`; database checker passed and old service recovered healthy |
| Implement and test private-directory compatibility | complete | Maintenance containers use `--user 0:0`; restore returns ownership to the runtime UID/GID; build, 23/23 full tests, 9/9 focused tests and syntax/diff checks passed |
| Commit and push the patch | complete | `e261aeb` pushed normally to `origin/codex/infinite-canvas` |
| Retry production update and verify existing data/health | complete | Installer created a validated private backup, fast-forwarded `56e29a7..e261aeb`, rebuilt successfully and returned healthy |

### Safety Boundary

- Do not remove volumes, reinitialize the database, overwrite `.env`, expose secret values, or delete existing backups.
- Do not relax private backup directories from `0700`; use an explicit root maintenance user only for bounded one-shot database operations.

### Completion Notes

- The update-time backup and a post-update manual `deploy/backup.sh` run both completed with private `0700 root:root` backup directories and database validation.
- Production listens on `0.0.0.0:3102`; UFW allows `3102/tcp`; the local health endpoint returns an OK response.
- The update-before backup and live database passed their respective database checks. Core business-table counts and irreversible hashes matched before and after the update; this new deployment currently has zero rows in those tables.
- The live database remains owned by the application runtime UID/GID `1000:1000`. Three private backups are retained under the configured backup root.
- Public access from the current workstation still timed out after host-level checks passed. If public IP access is required, verify the Alibaba Cloud security group admits inbound TCP `3102`; no instance RAM role or local Alibaba CLI was available to inspect or change that cloud rule from SSH.

### Recovery Instructions

This goal has no incomplete backup or update step. Future maintenance should use `sudo h` or the one-click installer. Preserve the existing backups and `.env`; create a new goal for any Alibaba Cloud security-group change or domain/HTTPS setup.

## Completed Goal: User-Owned Image Relay Key

- Status: complete
- Historical note: this section records the accepted 2026-07-31 image-only contract. The active 2026-08-01 goal supersedes its fixed-endpoint, endpoint-display, and image-only scope with three per-user keys and three administrator address/model controls; the user-owned image key and zero-site-charge clauses remain authoritative.
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

> Historical API contract only. Current account responses expose no endpoint, and the active contract covers text, image, and video user keys.

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

- Historical note: this completed audit used the then-current `gpt-5.6-luna`/`xhigh` setting. The current project rule is `gpt-5.6-sol` with `Ultra`, one worker at a time by default, and child threads remain unpinned.
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

## Completed Goal: Public-Port Deployment and `h` Management Panel

- Status: complete
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
| Compose/env/docs/integration/acceptance/push | Commander | complete |

### Current Evidence

- `npm.cmd run build`: passed.
- `npm.cmd test`: 21/21 passed.
- `node --test tests/production-config.test.mjs`: 7/7 passed.
- `bash -n deploy/install.sh deploy/manage.sh deploy/backup.sh deploy/restore.sh`: passed.
- `node --check server/app.js` and `node --check server/check-db.js`: passed.
- `git diff --check`: passed with existing LF-to-CRLF warnings only.
- Docker is unavailable on this Windows workstation; actual Ubuntu/Debian Compose, Nginx, Certbot and UFW execution remains a deployment-host verification.

- Final delivery commit: `d3a9d5e` (`feat: add public port deployment and h management panel`).
- Push result: `origin/codex/infinite-canvas` accepted the update without force-push.
- Follow-up `git ls-remote` was attempted for confirmation but timed out due to transient GitHub connectivity after the successful push response.

### Recovery Instructions

This goal is complete. Start the next accepted idea as a new recoverable goal, inspect the current Git state first, and preserve the real browser draft and running `3102/5182` services.

## Completed Goal: Deployment Maintenance Safety Hardening

- Status: complete
- Started: 2026-07-31
- Completed: 2026-07-31
- Commander thread: `019fb394-3b22-7111-87ad-f4ae56f97411`
- Objective: harden repeat installs, `h` operations, relay-secret migration, proxy trust, backup/restore boundaries and failure rollback, then verify, commit and push the current branch.

### Success Criteria

- Repeat installs and `h safe_update` use the fetched commit, accept only fast-forward updates, create a validated backup and restore code/environment/application/Nginx state on failure without falsely reporting success.
- Existing domain deployments bind the app to loopback so the public application port cannot bypass Nginx/HTTPS; public mode ignores forged forwarding headers.
- Text/video relay keys migrate from legacy `.env` storage into encrypted SQLite settings; blank keeps the current key, `CLEAR` remains cleared, stored keys are never displayed and credential-bearing URLs are rejected.
- Backup roots and database files cannot escape through symbolic links; validated backups and rescue snapshots remain available when service recovery itself fails.
- Build, complete tests, focused deployment tests, Shell/Node syntax, diff/secret checks, local health and final review pass before normal GitHub push.

### Steps

| Step | Owner | Status | Verification |
| --- | --- | --- | --- |
| Inspect current deployment and relay maintenance failures | Commander plus one read-only auditor | complete | Latest worktree and failure paths reviewed; final auditor found no P0-P3 reproducible code issue |
| Harden installer, manager, backup/restore and relay configuration | Commander | complete | Deployment contract tests cover rollback, managed keys, URL credentials, proxy trust and canonical backup boundaries |
| Run final gates and local health/secret checks | Commander | complete | Build passed; full tests 23/23; focused tests 9/9; four Shell and four Node syntax checks; diff check; 44-file scan; 3102/5182 HTTP 200 |
| Commit and push implementation | Commander | complete | `7c48c59` pushed normally to `origin/codex/infinite-canvas` |
| Synchronize durable status, memory and decisions | Commander | complete | AGENTS/HANDOFF/GOALS/PROJECT_MEMORY/STATUS/DECISIONS updated with current model, pinning and deployment contracts |

### Residual Host Validation

- This Windows workstation does not provide Docker, Nginx, Certbot or UFW. Run failure injection on an actual Ubuntu/Debian systemd host and use `docker inspect` to confirm old environment secrets are physically absent after force recreation. This is an integration-host limitation, not a current P0-P2 code blocker.

### Recovery Instructions

The goal is complete. Start from `git status`, `STATUS.md` and the actual remote branch. Keep only the current commander thread pinned; child threads remain unpinned and default to `gpt-5.6-sol` with `Ultra` reasoning.
