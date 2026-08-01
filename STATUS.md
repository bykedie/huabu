# Main Status

## Current

- Active goal: restore `api.bkbk.baby`, split the `h` relay configuration into text/image/video entries, deploy safely and complete public acceptance without losing data, secrets or backups.
- Confirmed public failure: `api.bkbk.baby` is a CNAME to `bkbk.baby`, which currently resolves to `64.83.20.132`; the actual ECS used for this deployment is `116.62.191.104`.
- The correct ECS is not ready for this hostname yet: forcing HTTP to `116.62.191.104` returns `403 Forbidden` from `Server: Beaver`, while forced HTTPS resets. DNS correction alone will therefore not complete the repair; the ECS Nginx/HTTPS virtual host and certificate must also be corrected.
- Local implementation is committed and pushed as `80ba173`: `h` now exposes `8 配置文字中转`, `9 配置图片中转`, and `10 配置视频中转`; later menu items are numbered 11-17.
- Text/video continue through encrypted database maintenance. The image entry never accepts an administrator image URL or key, keeps `https://www.bkbk.baby/` fixed, and only validates and writes `AI_IMAGE_MODELS`; failed health checks restore the prior `.env` and attempt to restore the old service.
- Modified implementation files are `README.md`, `deploy/manage.sh`, and `tests/production-config.test.mjs`; this status/goal/decision synchronization adds only recovery documentation.
- One read-only `gpt-5.6-sol`/`Ultra` audit completed. It found one trailing-empty-model validation gap; the commander fixed it and added coverage. No remaining code or secret-boundary issue was reported.
- Production DNS/Nginx/HTTPS has not been changed in this round. That traffic switch requires explicit approval immediately before execution and must retain a reversible copy of existing site state.
- Never delete or overwrite `.env`, the application database, Docker volumes, relay keys or any directory under `/srv/canvas-backups`.

## Completed

- Added authenticated `PUT`/`DELETE /api/me/image-key` and `POST /api/me/image-key/test` routes.
- Added `imageApiKeyConfigured` to the public user contract without returning key material or ciphertext.
- Stored each user's image key with AES-256-GCM server-side encryption and enforced user isolation.
- Removed administrator shared-image routes, configuration UI, image point settings, and image charge wording. Legacy database columns remain only for old-schema compatibility and are not used by runtime image requests.
- Added account-security controls for save, test, replace, and clear with the fixed endpoint displayed read-only. The input value is transient and cleared after each request; it is not stored in localStorage, canvas documents, notices, or logs.
- Preserved image request idempotency, content-conflict detection, reference-image edits, retry-after-failure behavior, and cache replay.
- Corrected the desktop image toolbar so it is centered in the visible canvas region and remains horizontally scrollable when its contents are wider than the available space.
- Completed desktop and `390x844` mobile geometry checks for the image toolbar, settings popover, panel-open/panel-closed offsets, Dock, navigation, Account Security drawer, and Operations drawer.
- Verified an unconfigured user is stopped before canvas save, reference-image processing, media work, or `/api/ai/image`: clicking Generate Image opened Account Security and produced zero network requests.
- Updated deployment examples and project memory/decision documents for the fixed endpoint and user-owned-key scheme.
- Added and accepted the video node UI, independent video administration, async generation/polling, upload/download/asset flow, exact-origin media allowlist, unsafe DNS/IP rejection, manual redirect validation, authorization-header isolation, quota-terminal refund, and recoverable download-error behavior.
- Synchronized `AGENTS.md`, handoff/memory/decision files, the archived visual specification/plan, and all three worker status files with the accepted implementation and browser evidence.
- Added `deploy/install.sh` and `deploy/manage.sh` with a documented one-line Ubuntu/Debian deployment command. Default install publishes 0.0.0.0:3102, accepts validated --port/--bind, preserves .env/data, rejects dirty or divergent repositories, backs up before fast-forward updates, safely installs /usr/local/bin/h, reports the public IP URL and warns about unencrypted HTTP. The h panel covers service, update, port, domain/HTTPS, text/video relay, quota, backup/restore, logs, diagnostics and administrator-token operations with hidden secret input.
- Hardened repeat installs and `h safe_update` with `FETCH_HEAD`, fast-forward validation, validated backups, code/environment/application/Nginx rollback, clean-worktree checks, accurate recovery messages and retained `0600` rescue snapshots when rollback cannot be confirmed.
- Added encrypted terminal relay maintenance with managed tombstones for legacy `.env` migration and explicit `CLEAR`; URLs with embedded credentials are rejected, legacy environment keys are cleared, and the app container is force-recreated.
- Enforced `127.0.0.1` binding for existing domain deployments, ignored forwarded headers in public mode and trusted one loopback Nginx hop in domain mode.
- Rejected backup/restore database symlinks and rechecked canonical backup roots after creation; validated backups survive service-recovery failure.
- Fixed private deployment backup validation without relaxing permissions: one-shot database maintenance runs as root, restored files return to the application owner, and both update-time and manual production backups now pass.
- Kept both canvas and node context menus inside the usable viewport, including live window resizing and short viewports that require internal menu scrolling, without changing the canvas insertion anchor.

## Next

1. Obtain explicit approval for the high-impact DNS and reverse-proxy switch, then change `api.bkbk.baby` to the actual ECS and configure the hostname/certificate through the safe production path.
2. Fast-forward production through the validated backup workflow and verify the 17-item `h` menu, healthy container, preserved data/backups, HTTP-to-HTTPS redirect, matching certificate, HTTPS health endpoint and rendered application.

## Blockers

- The production traffic switch has not been approved in the current execution step. DNS and Nginx/HTTPS changes are intentionally pending because they can briefly interrupt public access.
- The existing `Beaver` listener/site on ports 80/443 may conflict with the project Nginx virtual host. Inspect its ownership and current site configuration before any replacement; do not disable or delete it without a reversible backup and explicit confirmation.
- Automated SSH authentication is not available. Production commands may require the user to enter them in the already-authenticated MobaXterm session, unless a separate non-UI authenticated path becomes available.

## Evidence

- Public DNS recheck on 2026-08-01: `api.bkbk.baby CNAME bkbk.baby`; `bkbk.baby A 64.83.20.132`.
- Forced-origin recheck: HTTP request to `116.62.191.104` with host `api.bkbk.baby` returned `403 Forbidden` and `Server: Beaver`; forced HTTPS reset the connection.
- Current worktree before document synchronization contained only `README.md`, `deploy/manage.sh`, and `tests/production-config.test.mjs`, with 58 insertions and 11 deletions.
- Fresh local gates for this goal: `npm.cmd run build` passed; full tests passed 23/23; focused production tests passed 9/9; four deployment Shell files and four server Node files passed syntax checks; `git diff --check` passed with line-ending warnings only; targeted scan found no administrator image URL/key write.
- GitHub delivery: implementation and recovery documents were committed as `80ba173` and pushed without force to `origin/codex/infinite-canvas` (`ade00c3..80ba173`).

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
- Mobile Account Security and Operations drawers: width `390`, no horizontal overflow; fixed endpoint displayed exactly as `https://www.bkbk.baby/`; old shared-image controls had zero DOM matches.
- Browser runtime checks: no console warning/error, page error, failed request, HTTP error, or external request in the accepted isolated scenarios.
- Video acceptance: generated WebM `readyState=4`, no media error, download control inside the preview, asset save succeeded, and the mobile model/size/duration controls stayed in one row without page overflow.
- GitHub delivery: commit `7c48c59` pushed normally to `origin/codex/infinite-canvas` (push response advanced `467ce07..7c48c59`).
- Current goal gates: npm.cmd run build passed; npm.cmd test passed 23/23; node --test tests/production-config.test.mjs passed 9/9; bash -n deploy/install.sh deploy/manage.sh deploy/backup.sh deploy/restore.sh passed; four Node syntax checks passed; git diff --check passed with existing LF-to-CRLF warnings.
- Context-menu round gates on 2026-08-01: `npm.cmd run build` passed; `npm.cmd test` passed 23/23; four Node syntax checks and `git diff --check` passed.
- Context-menu desktop acceptance: at `1280x720`, a right-click at `1274,714` produced a `176x264` menu at `x=1096,y=448`, leaving exactly 8px at the right and bottom; resizing the open menu to `900x500` moved it to `x=716,y=228`, again leaving 8px.
- Context-menu node acceptance: at `900x500`, the two-item node menu measured `176x79` at `x=716,y=413`, leaving 8px at the right and bottom.
- Context-menu short-viewport acceptance: at `240x220`, the seven-item menu stayed inside `x=56..232` and `y=8..212`; `scrollHeight=262`, `clientHeight=202`, and page `scrollWidth=clientWidth=240`. Browser warning/error logs were empty.
- Context-menu GitHub delivery: implementation `4aae778` and recovery-document commit `f6192ce` were pushed normally to `origin/codex/infinite-canvas`.
