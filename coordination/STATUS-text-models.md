# Web Relay, Models, Billing, and Rename Status

- Updated: 2026-08-02 03:43 +08:00
- Status: complete; GitHub feature delivery complete, production update pending
- Owner: commander/main thread; this round may use concurrent bounded workers, with an absolute limit of 3 active subthreads
- Baseline: `11f6fa8312c8610df38924be0276b6364fc1f606`, equal to `origin/codex/infinite-canvas`; clean at start

## Completed

- Inspected `git status`, current recovery documents, both user screenshots one at a time, the current server/frontend/deployment/tests, and the local `basketikun/infinite-canvas` reference checkout.
- Confirmed the h panel exposes duplicate relay setup at items 8/9/10.
- Confirmed Operations fetches only text models and merges saved selections into new results, which preserves obsolete checked models.
- Confirmed text relay tests and runtime both post only to `/chat/completions`, while the reference OpenAI text implementation posts to `/responses` and parses `output_text` or nested output content.
- Confirmed image/video models are manual comma-separated inputs; the top-right action opens the wallet; point/recharge UI remains reachable; text/video runtime still charges site points; canvas title editing is double-click-only.
- Recorded the user's new standing concurrency cap: at most 3 active subthreads, replacing the older 10-worker allowance.
- Confirmed the pre-change automated baseline passes `32/32`.
- Added focused regressions for empty model defaults, three-kind upstream discovery, Responses-first text behavior with restricted fallback, default zero site billing, hidden point/recharge UI, the API-key header entry, touch-accessible rename, removed h relay entries, and deployment defaults.
- Implemented the backend contract: empty text/image defaults, generic text/image/video model discovery using the current administrator's matching user key, Responses-first text calls with 404/405-only fallback, and `SITE_BILLING_ENABLED=0` by default while retaining the opt-in ledger path.
- Focused backend modernization tests now pass `4/4`; `node --check server/app.js` passes.
- Migrated the legacy server fixtures and expectations; `tests/server.test.mjs` now passes `19/19`.
- Implemented the frontend contract: three-kind model discovery and replacement selection, top-right API-key entry, hidden wallet/recharge surfaces, zero point language in generation notices, and click/touch canvas rename.
- Removed the h relay configuration entries, kept item 5 as safe update, and synchronized deployment defaults and README guidance with web-based relay administration.
- Frontend/deployment contract tests pass `4/4`; the production configuration suite passes `12/12`; `npm.cmd run build` passes.
- Removed the final obsolete production assertion that required `AI_IMAGE_BASE_URL` and `AI_IMAGE_MODELS` to be documented as terminal-facing README configuration. Their compatibility defaults remain verified in `.env.example` and Compose.
- Full `npm.cmd test` passed `40/40`: server `19/19`, production configuration `12/12`, relay modernization `4/4`, web contract `4/4`, and UUID `1/1`.
- Final build passed with `index-CuruJLMo.js` and `index-CUxjUyFM.css`; four Node and four Shell syntax checks, credential scan, and `git diff --check` passed.
- Desktop `1440x1000` and mobile `390x844` acceptance passed on isolated ports `3123/3124`: three keys and zero endpoints, three model discovery/save/selection paths, Responses text, replacement candidate reset, hidden billing/recharge UI, API-key header entry, rename persistence, Dock/sidebar interactions, zero page overflow, and zero console warnings/errors.
- Stopped the isolated application and relay, removed the temporary database/mock/logs, closed the isolated tab, and reset the viewport. Real `3102/5182` were not touched.

## Next

1. User enters item 5 in the MobaXterm `h` panel.
2. Verify deployed SHA, backup, database, health, rendered UI, three discovery/generation paths, and rename persistence.

## Blockers

- None for GitHub delivery. Production acceptance waits for the user's MobaXterm item 5 update.

## Verification

- Existing suite before new regressions: `32/32` passed.
- Backend modernization after implementation: `node --test tests/relay-modernization.test.mjs` passes `4/4`.
- Legacy server suite after fixture migration: `node --test tests/server.test.mjs` passes `19/19`.
- Frontend/deployment contract suite: `node --test tests/web-modernization-contract.test.mjs` passes `4/4`.
- Production configuration suite: `node --test tests/production-config.test.mjs` passes `12/12`.
- Complete suite: `npm.cmd test` passes `40/40`.
- Build: `npm.cmd run build` passes with `index-CuruJLMo.js` and `index-CUxjUyFM.css`.
- Syntax/delivery: four Node checks, four Shell `bash -n` checks, credential scan, and `git diff --check` pass.
- Browser: isolated desktop/mobile acceptance and fixture cleanup pass; console warning/error count is zero.

## Final Delivery Gate

- 2026-08-02 03:38 +08:00: Re-ran the complete pre-delivery gate after documentation synchronization. `npm.cmd test` passed `40/40`; `npm.cmd run build` passed with `index-CuruJLMo.js` and `index-CUxjUyFM.css`; production configuration passed `12/12`; four Node syntax checks, four Shell syntax checks, the credential scan, and `git diff --check` passed.
- Candidate scope matches the active goal: 19 modified tracked files plus `coordination/STATUS-text-models.md`, `tests/relay-modernization.test.mjs`, and `tests/web-modernization-contract.test.mjs`. No unrelated or temporary browser/mock/database/log file is present.
- Delivery boundary remains unchanged at this checkpoint: the candidate is unstaged, uncommitted, unpushed, and undeployed; production remains `3f7b52d`.
- 2026-08-02 03:43 +08:00: Created feature commit `99926be16bf561cfdb1ddfe4d51eb6ce4d7936e4`, pushed it normally to `origin/codex/infinite-canvas` (`11f6fa8..99926be`), fetched, and verified local/remote full SHA equality. Production remained untouched at `3f7b52d`.
