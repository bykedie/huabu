# Main Status

## Current

- Active goal: fully localize the `h` operations panel, deploy and verify it, then continuously audit and improve the canvas in bounded rounds until the user explicitly pauses.
- Current round: the `h` main menu, help, status, prompts, warnings, errors, results and downstream relay-maintenance output are localized. `CLEAR`, `RESTORE`, `SHOW`, menu numbering, command routing and safety behavior remain unchanged. Local verification passed: build, full tests 23/23, focused deployment tests 9/9, four Node syntax checks, four Bash syntax checks and `git diff --check`.
- Worker policy for this goal: the user permits up to 10 concurrent subagents. All 10 existing Infinite Canvas collaboration seats are active on bounded read-only audit tasks with `gpt-5.6-sol` and `Ultra`; none owns or may modify an implementation file in the current audit round. The commander alone owns integration edits.
- Confirmed root cause: `docker compose cp` created the expected flat backup layout, but `umask 077` made the host backup directory `0700 root:root`; the default `node` validation container could not traverse the bind-mounted `/backup` directory and misreported the existing database as missing.
- Accepted fix: bounded database maintenance containers in `deploy/install.sh`, `deploy/backup.sh`, and `deploy/restore.sh` run as `0:0`, while restore explicitly returns copied database files to the application runtime UID/GID. Private backup permissions remain `0700`.
- Production now runs clean commit `e261aeb`; the app is `running/healthy`, binds `0.0.0.0:3102`, and returns a healthy response on the host endpoint.
- The user-owned image relay migration remains complete and accepted; this audit must not reopen or replace that behavior without evidence of a real defect.
- Image relay behavior is fixed: the UI shows `https://www.bkbk.baby/`, the server calls only `https://www.bkbk.baby/v1/images/generations` or `/images/edits`, and every image call uses the authenticated user's encrypted key.
- Image requests reserve and charge zero site points. Success, upstream failure, retry after failure, cached replay, edit requests, and request-key conflicts are covered without changing balance or ledger entries.
- Text and video server contracts and billing remain independent from user image keys. The operations drawer contains separate text and video relay administration; the old shared image configuration remains absent.
- Frontend remains at `http://127.0.0.1:5182/`; the real API remains on port `3102`. Browser acceptance used disposable isolated instances and did not open or alter the real canvas draft.
- The isolated acceptance tab was closed, its temporary viewport was reset, processes `22464` (`3103`) and `23452` (`3113`) were stopped only after command-line and listener verification, and `.codex-acceptance` was removed. Only the real `3102/5182` listeners remain.
- Collaboration workers use `gpt-5.6-sol` with `Ultra` reasoning. Activate one worker at a time by default; the user may explicitly approve higher concurrency for a particular task, up to the runtime limit. Only the current commander thread is pinned; child/collaboration threads remain unpinned.
- The latest accepted production fix was committed and pushed on `codex/infinite-canvas` as `e261aeb` (`fix: validate private deployment backups`). Future tasks may create new dirty changes; never reset, checkout, clean or overwrite unrelated work.
- Browser acceptance, document synchronization, isolated-environment cleanup, and the fresh final gate rerun are complete.

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

## Next

1. Review and commit the localized management surface and its tests, then push normally.
2. Fast-forward production through the validated backup/update path and verify Git state, localized `h --help`, container health and `/api/health` without deleting data or backups.
3. Begin the first evidence-driven canvas audit round and continue iterating until the user pauses.

## Blockers

- No subagent scheduling blocker remains; 10 existing collaboration seats are running bounded read-only audits and have been instructed to return concise evidence before the next implementation round.
- Public-IP reachability may still depend on the Alibaba Cloud security group, which was not inspectable from the instance because no RAM role or Alibaba CLI was available.
- The real browser may still contain a valuable local canvas draft or version conflict; do not resolve it destructively as part of cleanup.

## Evidence

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
