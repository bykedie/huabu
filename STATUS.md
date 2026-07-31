# Main Status

## Current

- The one-command deployment and GitHub push goal is complete. No implementation goal is currently active.
- The user-owned image relay migration remains complete and accepted; this audit must not reopen or replace that behavior without evidence of a real defect.
- Image relay behavior is fixed: the UI shows `https://www.bkbk.baby/`, the server calls only `https://www.bkbk.baby/v1/images/generations` or `/images/edits`, and every image call uses the authenticated user's encrypted key.
- Image requests reserve and charge zero site points. Success, upstream failure, retry after failure, cached replay, edit requests, and request-key conflicts are covered without changing balance or ledger entries.
- Text and video server contracts and billing remain independent from user image keys. The operations drawer contains separate text and video relay administration; the old shared image configuration remains absent.
- Frontend remains at `http://127.0.0.1:5182/`; the real API remains on port `3102`. Browser acceptance used disposable isolated instances and did not open or alter the real canvas draft.
- The isolated acceptance tab was closed, its temporary viewport was reset, processes `22464` (`3103`) and `23452` (`3113`) were stopped only after command-line and listener verification, and `.codex-acceptance` was removed. Only the real `3102/5182` listeners remain.
- Collaboration workers use `gpt-5.6-luna` with `xhigh` reasoning (user wording: "超高"). Activate one worker at a time by default; the user may explicitly approve a higher concurrency for a particular task, up to the runtime limit.
- The accepted delivery was committed and pushed on `codex/infinite-canvas`. Future tasks may create new dirty changes; never reset, checkout, clean or overwrite unrelated work.
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
- Added `deploy/install.sh` and a documented one-line Ubuntu/Debian deployment command. First run installs dependencies and generates secrets without printing them; reruns preserve `.env`/data, reject dirty or divergent repositories, back up a running database, and only fast-forward the configured branch.

## Next

1. Wait for the next user-confirmed idea, then create a new recoverable goal before editing.
2. For server deployment, replace the example domain/email in the README one-line command and run it on an Ubuntu/Debian systemd host.
3. Preserve the existing Git history, production `.env`, Docker data volume and matching `JWT_SECRET`.

## Blockers

- No technical blocker is known.
- The real browser may still contain a valuable local canvas draft or version conflict; do not resolve it destructively as part of cleanup.

## Evidence

- `npm.cmd run build`: passed on 2026-07-31; final assets are `index-DEhlsHSV.css` and `index-UkhmACLV.js`.
- `npm.cmd test`: final suite with deployment coverage passed 21/21.
- `node --test tests/production-config.test.mjs`: deployment-focused suite passed 7/7.
- `node --check server/app.js` and `node --check server/check-db.js`: passed.
- `git diff --check`: passed with existing LF-to-CRLF warnings only.
- Secret-pattern review scanned 39 current tracked/untracked source and document files without echoing candidate values; suspicious candidates: 0.
- Git runtime Bash: `bash -n deploy/install.sh deploy/backup.sh deploy/restore.sh` passed; `deploy/install.sh --help` also passed. Docker is unavailable on this host, so no local Compose/Nginx/Certbot install was attempted.
- Post-cleanup runtime health: `http://127.0.0.1:3102/api/health` returned `200 {"ok":true}` and `http://127.0.0.1:5182/` returned `200 text/html`; only ports `3102/5182` were listening among `3102/3103/3113/5182`.
- Desktop toolbar with panel open: center `x=860`, matching the visible canvas center; panel closed: center `x=720`, matching the viewport center.
- Desktop settings popover: fully visible inside `1440x1000`; page `scrollWidth=clientWidth=1440`.
- Mobile page: `scrollWidth=clientWidth=390`; image toolbar `clientWidth=376`, `scrollWidth=785`; Dock `clientWidth=368`, `scrollWidth=513`; both reached their final controls after horizontal scrolling.
- Mobile Account Security and Operations drawers: width `390`, no horizontal overflow; fixed endpoint displayed exactly as `https://www.bkbk.baby/`; old shared-image controls had zero DOM matches.
- Browser runtime checks: no console warning/error, page error, failed request, HTTP error, or external request in the accepted isolated scenarios.
- Video acceptance: generated WebM `readyState=4`, no media error, download control inside the preview, asset save succeeded, and the mobile model/size/duration controls stayed in one row without page overflow.
- GitHub delivery: commit `d5006e0` pushed normally to `origin/codex/infinite-canvas`; the documented remote installer returned HTTP 200 and matched the local committed file byte-for-byte.
