# Main Status

## Current

- The AI creation/context and canvas node-interaction goal is complete on GitHub. All five screenshots were reviewed one original image per turn; no screenshot remains pending and no derived image was created or inspected.
- Baseline was clean `codex/infinite-canvas` at `77e8ceff63c49f9930e73bdb4f45cc6d9573e20a`. Feature commit `ca6ed672541b70c357edc5acd9cbbd84a1f43ddb` was pushed normally to `origin/codex/infinite-canvas`; production remains undeployed and no reset or unrelated cleanup was performed.
- The implementation now includes typed recursive text/image context, a compact AI card, one system font stack, draft-or-image top import, hidden ready-image URLs, locked/free image rendering, eight-way resize, dedicated text/note/AI drag handles and a node-local clamped/self-scrolling image toolbar.
- Final browser acceptance passed at desktop `1440x1000`, default `1280x720` and mobile `390x844`: typed note/image connections, pan, zoom, locked/free resize, drag surfaces, toolbar scrolling, settings geometry, low-height Dock avoidance, page overflow and console state were verified.
- Final automated evidence is focused `10/10`, full `50/50`, build assets `index-BxkgO0oh.css` and `index-biUS_uuq.js`, plus `git diff --check` with line-ending warnings only.
- The isolated `3113` service, temporary database/account/canvases and browser tab were removed. Real API `3102` and Vite `5182` still return HTTP 200 and retain their original processes. Recovery evidence is in `coordination/STATUS-ai-creation.md`.
- Active goal complete on GitHub: web-only relay configuration, three-kind upstream model discovery, Responses-first text compatibility, default-disabled site billing, top-right API-key access, hidden point/recharge surfaces, and canvas rename repair. Local implementation, automation, security review, desktop/mobile acceptance, cleanup, durable-document synchronization, commit, and normal push are complete.
- Branch: `codex/infinite-canvas`. Feature delivery commit `99926be16bf561cfdb1ddfe4d51eb6ce4d7936e4` and its documentation-only delivery closeout are on `origin/codex/infinite-canvas`. Production remains undeployed for this round.
- Current implementation removes h relay items, discovers text/image/video models with the administrator's corresponding user key, replaces candidates and clears old selections, calls Responses first with 404/405-only Chat Completions fallback, hides point/recharge surfaces, defaults text/video to zero site billing, and supports click/touch/Enter canvas renaming with persistence.
- Recovery and verification evidence for this round is recorded in `coordination/STATUS-text-models.md`; feature delivery is `99926be`, and the prior three-key delivery is present in `fde4fb2` and `11f6fa8`.
- Current execution limit: no more than 3 concurrent subthreads; this replaces the older 10-worker allowance.
- Production remains at the last separately verified SHA `3f7b52d`; none of the current interaction, three-key, model-discovery, Agent, deployment-contract, or reflection-guard changes are in production yet.
- Current relay contract: the authenticated user's encrypted text, image, or video key authenticates that relay kind. Administrators manage three independent addresses and open-model lists, not shared runtime keys. Account Security exposes exactly three key controls and no endpoint.
- Administrator relay tests and text/image/video upstream discovery use that administrator's saved corresponding user key. Site billing defaults off: text/video reserve and charge zero site points without ledger writes; the explicit opt-in path remains test-covered, and image remains zero site points.
- Legacy shared-key columns remain inert additive-schema compatibility fields. Compose, `h`, administrator APIs and runtime paths do not use them as credentials.
- Upstream-controlled errors, content, usage, models, images, task fields and cached results are guarded against raw or encoded current-key reflection into responses, logs, audits, generations or ledgers.
- Execution defaults to one worker; when concurrency is explicitly approved, the current absolute cap is 3 active child workers/subthreads.
- Prior four-access-mode and deployment work remains part of the accepted baseline and must not be regressed.
- Confirmed public failure: `api.bkbk.baby` is a CNAME to `bkbk.baby`, which currently resolves to `64.83.20.132`; the actual ECS used for this deployment is `116.62.191.104`.
- The correct ECS is not ready for this hostname yet: forcing HTTP to `116.62.191.104` returns `403 Forbidden` from `Server: Beaver`, while forced HTTPS resets. DNS correction alone will therefore not complete the repair; the ECS Nginx/HTTPS virtual host and certificate must also be corrected.
- The accepted local implementation now adds `MOYU_ACCESS_MODE=public|domain|both|private`. Fresh deployment defaults to public IP plus port, detects and displays public IPv4, while `h` item 6 manages all four modes and item 7 changes the application port.
- Mode mapping is explicit: public/both bind `0.0.0.0`; domain/private bind `127.0.0.1`; only domain/both enable this project's Nginx link. Old `.env` files without a mode are inferred from domain and bind, and repeat installs preserve the selected mode.
- README now documents a one-line GitHub deployment with `--domain api.bkbk.baby` for the future second server. The installer clones the delivery branch, generates first-run secrets locally, preserves existing `.env` and the data volume on reruns, validates backups before fast-forward updates, and rolls back failed application/Nginx changes.
- `h` no longer contains text/image/video relay entries; safe update remains item 5. Web Operations is the only normal surface for relay addresses, model discovery, and open-model selection. `AI_IMAGE_BASE_URL` remains only a server default/fallback.
- Image relay URLs require HTTPS in production, reject credentials/query/fragment and unsafe DNS/IP targets, and image requests use manual redirects so user authorization cannot follow an unvalidated redirect.
- At the user's explicit request, `h status` now displays administrator email/password to root. Administrator registration and password changes store an AES-256-GCM ciphertext alongside the bcrypt hash; application APIs never expose it, legacy administrators require one password change, and backup validation checks it with the dedicated `admin-login` derived key.
- The earlier relay audit found one trailing-empty-model validation gap, which was fixed. The final read-only audit completed; its stale help/recovery wording findings were corrected, while its Nginx-link concern was already covered by the current installer rollback logic and tests.
- Production was safely updated to `3f7b52d` and switched to `public`: `0.0.0.0:3102`, detected IPv4 `116.62.191.104`, healthy container and public health endpoint. All later CSP, root-credential, interaction and three-key work remains local until a new verified production update.
- Never delete or overwrite `.env`, the application database, Docker volumes, relay keys or any directory under `/srv/canvas-backups`.

## Completed

- Unified the application font stack with local SF Pro/Segoe UI/PingFang/Microsoft YaHei/Helvetica/Arial fallbacks and made native `select`/`option` controls inherit the same typography; no remote font dependency was added.
- Added a pure typed generation-context builder: only connected text/note nodes enter visible prompts, connected images remain capped typed references, and video/AI/group fields, media URLs and `data:` payloads do not leak into prompt text.
- Routed the top-right import action between one draft JSON and one or more images while preserving the existing JSON overwrite confirmation and image compression/node/autosave path.
- Image nodes now hide the URL editor after a usable preview exists, including internal `data:` images; locked resize uses contained rendering, free resize fills the selected node bounds. Text and note nodes expose a 36px drag handle, while AI nodes use a 44px title/mode drag header; editable controls remain `nodrag`.
- Restructured the existing `336x320` AI node into a compact title/mode header, elastic prompt section, typed connection summary, fixed settings section and bottom generation action. AI nodes enforce a safe `300x280` minimum, and old server/draft node sizes normalize before display and undo-history capture.
- Expanded `tests/ai-creation-contract.test.mjs` to `10/10`; the complete suite passes `50/50`, build produces `index-BxkgO0oh.css` and `index-biUS_uuq.js`, and `git diff --check` passes with existing line-ending warnings only.
- Replaced application-fixed image tools with a React Flow node-local toolbar that follows node movement and canvas transforms, clamps to the active canvas, scrolls its own contents and flips below the node when the top edge lacks room.
- Kept the image settings panel above the bottom canvas Dock in short viewports and made it internally scrollable; accepted geometry passed at `1280x720` and `390x844`, and its final action remained clickable.
- Browser acceptance confirmed typed `1 段文本 · 1 张图片` context, one visible reference image, eight resize controls, locked-aspect error below `0.0001`, free-width resize, AI/title dragging, zero page overflow and empty application warning/error logs.
- Added Responses-first text relay handling with `output_text` and nested output parsing, and restricted Chat Completions fallback to upstream 404/405.
- Added text/image/video upstream model discovery, empty fresh text/image model defaults, replacement candidate lists, and explicit administrator selection.
- Added `SITE_BILLING_ENABLED`, defaulted it to `0`, retained the opt-in ledger path, and hid wallet, balance, redeem, recharge, recharge review, and point wording from the current web UI.
- Replaced the top-right balance action with the API-key account entry and removed the three relay configuration entries from `h` while retaining safe update as item 5.
- Fixed canvas rename entry and Enter completion; desktop acceptance confirmed the new name persisted in SQLite and after refresh.
- Added a shared browser UUID helper with secure-context and no-`crypto` fallbacks; genuine ordinary HTTP refresh restored the accepted canvas instead of producing a blank root.
- Completed command-menu/sidebar separation, repeatable close behavior, every Dock action, clear/undo, navigation, appearance, upload and responsive Agent geometry.
- Added encrypted per-user text, image and video key save/test/replace/clear paths; all runtime and video-poll operations use the authenticated user's corresponding key.
- Replaced administrator shared-key surfaces with text/image/video address/model controls, text model discovery, and administrator-owned-key tests.
- Added Agent and text-generation node selection for administrator-opened text models; both submitted the second discovered model successfully in browser acceptance.
- Closed upstream key-reflection paths across video errors/tasks/downloads, text content/usage, image results, models, API responses, logs and persisted/cached records.

- Added authenticated `PUT`/`DELETE /api/me/image-key` and `POST /api/me/image-key/test` routes.
- Added `imageApiKeyConfigured` to the public user contract without returning key material or ciphertext.
- Stored each user's image key with AES-256-GCM server-side encryption and enforced user isolation.
- Removed administrator shared-image routes, configuration UI, image point settings, and image charge wording. Legacy database columns remain only for old-schema compatibility and are not used by runtime image requests.
- Historical image-only note: the earlier account control displayed the server-selected image endpoint read-only. The active three-key UI supersedes that behavior and displays no endpoint; each input remains transient and clears after requests.
- Preserved image request idempotency, content-conflict detection, reference-image edits, retry-after-failure behavior, and cache replay.
- Corrected the desktop image toolbar so it is centered in the visible canvas region and remains horizontally scrollable when its contents are wider than the available space.
- Completed desktop and `390x844` mobile geometry checks for the image toolbar, settings popover, panel-open/panel-closed offsets, Dock, navigation, Account Security drawer, and Operations drawer.
- Verified an unconfigured user is stopped before canvas save, reference-image processing, media work, or `/api/ai/image`: clicking Generate Image opened Account Security and produced zero network requests.
- Updated deployment examples and project memory/decision documents for the user-owned-key scheme; the later server-configurable endpoint decision now supersedes the historical fixed endpoint.
- Added and accepted the video node UI, independent video administration, async generation/polling, upload/download/asset flow, exact-origin media allowlist, unsafe DNS/IP rejection, manual redirect validation, authorization-header isolation, quota-terminal refund, and recoverable download-error behavior.
- Synchronized `AGENTS.md`, handoff/memory/decision files, the archived visual specification/plan, and all three worker status files with the accepted implementation and browser evidence.
- Added `deploy/install.sh` and `deploy/manage.sh` with a documented one-line Ubuntu/Debian deployment command. Default install publishes 0.0.0.0:3102, accepts validated --port/--bind, preserves .env/data, rejects dirty or divergent repositories, backs up before fast-forward updates, safely installs /usr/local/bin/h, reports the public IP URL and warns about unencrypted HTTP. The h panel covers service, update, port, domain/HTTPS, text/video relay, quota, backup/restore, logs, diagnostics and administrator-token operations with hidden secret input.
- Hardened repeat installs and `h safe_update` with `FETCH_HEAD`, fast-forward validation, validated backups, code/environment/application/Nginx rollback, clean-worktree checks, accurate recovery messages and retained `0600` rescue snapshots when rollback cannot be confirmed.
- Historical deployment hardening: terminal maintenance once used managed tombstones and `CLEAR` for legacy shared-key migration. The active contract supersedes that credential path; current terminal relay maintenance persists only address/model configuration and video points.
- Enforced `127.0.0.1` binding for existing domain deployments, ignored forwarded headers in public mode and trusted one loopback Nginx hop in domain mode.
- Rejected backup/restore database symlinks and rechecked canonical backup roots after creation; validated backups survive service-recovery failure.
- Fixed private deployment backup validation without relaxing permissions: one-shot database maintenance runs as root, restored files return to the application owner, and both update-time and manual production backups now pass.
- Kept both canvas and node context menus inside the usable viewport, including live window resizing and short viewports that require internal menu scrolling, without changing the canvas insertion anchor.

## Next

1. Keep production update and the DNS/Beaver 80/443 conflict outside this completed GitHub delivery unless the user separately requests them.
2. Preserve the accepted GitHub delivery and recovery evidence when starting any new canvas goal.
3. For any future screenshot-review goal, retain the one-original-image-per-turn context limit without treating it as a repeated authorization requirement.

## Blockers

- The existing `Beaver` listener/site on ports 80/443 may conflict with the project Nginx virtual host. Inspect its ownership and current site configuration before any replacement; do not disable or delete it without a reversible backup and explicit confirmation.
- Automated SSH authentication is not available. Production commands may require the user to enter them in the already-authenticated MobaXterm session, unless a separate non-UI authenticated path becomes available.

## Evidence

- AI creation GitHub delivery evidence: feature commit `ca6ed672541b70c357edc5acd9cbbd84a1f43ddb` advanced `origin/codex/infinite-canvas` from `77e8cef` without force; production was not touched.
- AI creation/node-interaction evidence: focused `10/10`; full `50/50`; build `index-BxkgO0oh.css` and `index-biUS_uuq.js`; `git diff --check` passed with line-ending warnings only.
- Desktop/default browser evidence: settings inside the active canvas; node and toolbar shared the same `(-90, -60)` pan delta; zoom changed `114%` to `68%`; locked corner resize retained aspect ratio within `0.0001`; toolbar stayed clamped, and the low-height settings panel avoided the bottom Dock.
- Mobile browser evidence: `390x844`, document `scrollWidth=clientWidth=390`, node-local toolbar `x≈8..386`, self-scroll reached `413/417`, settings remained fully visible, AI header drag moved the node about `(80, 67)`, and all eight image resize controls remained present.
- Context/import evidence: real connections produced `1 段文本 · 1 张图片` with one reference thumbnail; the top import input accepts `application/json,.json,image/*` with `multiple`, while draft-only and image-only inputs retain their narrower contracts.
- Cleanup/runtime evidence: port `3113` and its verified temporary directory were removed; the isolated tab closed and viewport reset; real `3102` returned `200 {"ok":true}` and `5182` returned HTTP 200 HTML.
- Current-round automated evidence: server `19/19`; production configuration `12/12`; relay modernization `4/4`; web contract `4/4`; UUID `1/1`; complete suite `40/40`; build passed with `index-CuruJLMo.js` and `index-CUxjUyFM.css`; four Node and four Shell syntax checks, credential scan, and global diff check passed.
- Current-round browser evidence: isolated ordinary HTTP application `127.0.0.1:3123` and synthetic relay `127.0.0.1:3124`; desktop `1440x1000` and mobile `390x844`; three keys, zero endpoints, zero billing surfaces, three model-discovery/save/selection paths, Responses text, candidate reset, rename persistence, sidebars, Dock reachability, zero page overflow, and empty browser warning/error logs.
- Current-round cleanup: fixture ports `3123/3124` have zero listeners; temporary mock, database and logs were removed; viewport reset and isolated tab closed; no cleanup command targeted real `3102/5182`.
- GitHub delivery evidence: feature commit `99926be16bf561cfdb1ddfe4d51eb6ce4d7936e4` was pushed normally (`11f6fa8..99926be`) to `origin/codex/infinite-canvas`; production remains `3f7b52d` and was not touched.

Historical evidence retained below applies to the dated rounds that produced it; it is not the latest test or delivery state.

- Public DNS recheck on 2026-08-01: `api.bkbk.baby CNAME bkbk.baby`; `bkbk.baby A 64.83.20.132`.
- Forced-origin recheck: HTTP request to `116.62.191.104` with host `api.bkbk.baby` returned `403 Forbidden` and `Server: Beaver`; forced HTTPS reset the connection.
- Current worktree before document synchronization contained only `README.md`, `deploy/manage.sh`, and `tests/production-config.test.mjs`, with 58 insertions and 11 deletions.
- Fresh local gates for this goal: `npm.cmd run build` passed; full tests passed 23/23; focused production tests passed 9/9; four deployment Shell files and four server Node files passed syntax checks; `git diff --check` passed with line-ending warnings only; targeted scan found no administrator image URL/key write.
- GitHub delivery: implementation and recovery documents were committed as `80ba173` and pushed without force to `origin/codex/infinite-canvas` (`ade00c3..80ba173`).
- Automatic-HTTPS follow-up gates: `npm.cmd run build` passed; full tests passed 23/23; focused deployment tests passed 9/9; all four deployment Shell files passed `bash -n`; `git diff --check` passed with line-ending warnings only.

- Production incident verification on 2026-08-01: old HEAD `56e29a7`; live database `/app/data/app.db` with WAL/SHM; the default `node` maintenance container could not traverse a `0700 root:root` backup bind, while `--user 0:0` could.
- Delivery commit `e261aeb` pushed normally and deployed by the exact SHA-256-verified installer. The update created a validated backup before fast-forwarding `56e29a7..e261aeb`, rebuilt the image, and returned healthy.
- Post-update manual `deploy/backup.sh` completed and produced another private `0700` backup. Production repository is clean, container state is `running/healthy`, host bind is `0.0.0.0:3102`, UFW allows TCP `3102`, and the local health endpoint returns an OK response.
- Update-before and live database checks passed. Core business-table counts and irreversible hashes matched before/after; this new deployment currently contains zero rows in users, canvases, assets, media, ledger, redeem, top-up, audit and generation tables. Live database ownership remains `1000:1000`.

- `npm.cmd run build`: passed on 2026-07-31; final assets are `index-DEhlsHSV.css` and `index-UkhmACLV.js`.
- `npm.cmd test`: final suite with deployment coverage passed 23/23.
- `node --test tests/production-config.test.mjs`: deployment-focused suite passed 9/9.
- `node --check server/manage-config.js`, `server/app.js`, `server/db.js`, and `server/check-db.js`: passed.
- `git diff --check`: passed with existing LF-to-CRLF warnings only.
- Secret-pattern review scanned 44 current tracked/untracked files without echoing candidate values; common secret matches: 0; URL credential matches: 0.
- Git runtime Bash: `bash -n deploy/install.sh deploy/manage.sh deploy/backup.sh deploy/restore.sh` passed; `deploy/install.sh --help` also passed. Docker is unavailable on this host, so no local Compose/Nginx/Certbot/UFW install was attempted.
- Post-cleanup runtime health: `http://127.0.0.1:3102/api/health` returned `200 {"ok":true}` and `http://127.0.0.1:5182/` returned `200 text/html`; only ports `3102/5182` were listening among `3102/3103/3113/5182`.
- Desktop toolbar with panel open: center `x=860`, matching the visible canvas center; panel closed: center `x=720`, matching the viewport center.
- Desktop settings popover: fully visible inside `1440x1000`; page `scrollWidth=clientWidth=1440`.
- Mobile page: `scrollWidth=clientWidth=390`; image toolbar `clientWidth=376`, `scrollWidth=785`; Dock `clientWidth=368`, `scrollWidth=513`; both reached their final controls after horizontal scrolling.
- Historical mobile acceptance for the image-only round: drawers were `390px` wide and old shared-image controls were absent; that round's read-only endpoint field was later removed by the active three-key UI.
- Browser runtime checks: no console warning/error, page error, failed request, HTTP error, or external request in the accepted isolated scenarios.
- Video acceptance: generated WebM `readyState=4`, no media error, download control inside the preview, asset save succeeded, and the mobile model/size/duration controls stayed in one row without page overflow.
- GitHub delivery: commit `7c48c59` pushed normally to `origin/codex/infinite-canvas` (push response advanced `467ce07..7c48c59`).
- Four-mode/image-relay gates on 2026-08-01: `npm.cmd run build` passed; `npm.cmd test` passed 24/24; focused deployment tests passed 10/10; four deployment Shell files and four server Node files passed syntax checks; `git diff --check` passed with line-ending warnings only.
- Four-mode/image-relay GitHub delivery: commit `5fa5804` pushed normally to `origin/codex/infinite-canvas`; fetched remote and local full SHA both equal `5fa580431cc4ad3e4eca82171bb361d2e7d2e085`.
- Production access-mode acceptance: `h status` reported `public`, `0.0.0.0:3102`, detected IPv4 `116.62.191.104`; Docker reported the application healthy, and `/api/health`, `/`, the hashed JS and CSS all returned HTTP 200 externally. Independent browser rendering still produced an empty `#root`; the response CSP contained `upgrade-insecure-requests`, proving the HTTP asset-upgrade defect.
- CSP follow-up gates: production build passed; full tests passed 25/25 including the new public-HTTP response-header regression; `node --check server/app.js` and `git diff --check` passed.
- Root credential-display follow-up gates: production build passed; full tests passed 27/27, including encrypted root status, administrator password-change synchronization, API non-disclosure, legacy schema migration and backup-key validation; four Node syntax checks, `bash -n deploy/manage.sh`, and `git diff --check` passed.
- Context-menu round gates on 2026-08-01: `npm.cmd run build` passed; `npm.cmd test` passed 23/23; four Node syntax checks and `git diff --check` passed.
- Context-menu desktop acceptance: at `1280x720`, a right-click at `1274,714` produced a `176x264` menu at `x=1096,y=448`, leaving exactly 8px at the right and bottom; resizing the open menu to `900x500` moved it to `x=716,y=228`, again leaving 8px.
- Context-menu node acceptance: at `900x500`, the two-item node menu measured `176x79` at `x=716,y=413`, leaving 8px at the right and bottom.
- Context-menu short-viewport acceptance: at `240x220`, the seven-item menu stayed inside `x=56..232` and `y=8..212`; `scrollHeight=262`, `clientHeight=202`, and page `scrollWidth=clientWidth=240`. Browser warning/error logs were empty.
- Context-menu GitHub delivery: implementation `4aae778` and recovery-document commit `f6192ce` were pushed normally to `origin/codex/infinite-canvas`.
