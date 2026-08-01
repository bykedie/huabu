# Relay Frontend Worker Status

## 2026-08-01 19:23:40 +08:00

- Status: in progress
- Ownership: `src/App.tsx`, `src/styles.css`, and this status file only.
- Goal: complete the three user relay-key controls and preflight checks, text/image/video operations UI, selectable text models for Agent and canvas nodes, and responsive panel layout without exposing endpoints or shared administrator keys.
- Completed: read the current scoped Git diff, backend worker status, and actual server routes. Confirmed user text/image/video save, clear, and test routes exist, while administrator routes are still the legacy shared-key contract and the backend worker has not yet finished replacing them.
- Next action: implement the route-stable account, generation preflight, model-selection, public-config cleanup, and layout changes; then re-read the backend routes before wiring Operations.
- Blockers: final Operations route names and payloads are not yet present in `server/app.js`; no frontend guess will be introduced.
- Verification evidence: the existing HTTP crypto fallback and sidebar/Dock changes in `src/App.tsx`, `src/styles.css`, and `src/uuid.ts` remain intact; no secret values were read or emitted.

## 2026-08-01 19:34:19 +08:00

- Status: in progress
- Completed: Account Security now renders text, image, and video user-key controls with save, test, replace, and clear actions against the real `/api/me/*-key` routes; all temporary inputs clear after each operation and no endpoint is displayed. Added text/image/video generation preflight checks before canvas saving or reference-media processing, added an Agent text-model selector with stable fallback, and removed `imageEndpoint` from the public frontend config shape. Re-read the concurrently updated backend and replaced the old shared-key Operations code with actual text/image/video address-and-model routes plus text model discovery.
- Next action: finish CSS for the three-column Operations tabs, model checklist, three-key sections, and Agent placement; run build and source checks, then fix any type or contract mismatches.
- Blockers: none. The backend routes are now present in actual code; backend status documentation has not yet recorded its final verification.
- Verification evidence: `src/App.tsx` no longer references `imageEndpoint`; all four generation entry points check the appropriate user configured boolean before `flushRef.current()`, reference-image conversion, or API calls; Operations request bodies contain no key fields.

## 2026-08-01 19:46:50 +08:00

- Status: complete
- Completed: finished the frontend relay product contract in `src/App.tsx` and `src/styles.css`. Account Security exposes exactly text, image, and video user-key controls with save/test/replace/clear actions and configured state from `User`; no endpoint or shared administrator key surface remains. Text node generation, image generation, video generation, and Agent sending open Account Security and return before canvas persistence, assistant draft mutation, reference-image conversion, request-key creation, or relay API calls when the matching user key is absent. Operations now has text/image/video tabs, address/model-only administrator forms, video points, text upstream model discovery with filterable checkboxes, and audit labels for all three configuration actions. Agent and canvas AI nodes submit explicit selected text models and fall back to the first still-open model when the list changes. The Agent panel starts below the 64px top bar, and drawer/model controls use bounded widths, wrapping actions, and mobile-safe layouts.
- Backend routes wired: `GET /api/config`; `GET /api/me`; `PUT` and `DELETE /api/me/text-key`, `/api/me/image-key`, `/api/me/video-key`; `POST /api/me/text-key/test`, `/api/me/image-key/test`, `/api/me/video-key/test`; `GET /api/admin/overview`; `PUT /api/admin/text-config`, `/api/admin/image-config`, `/api/admin/video-config`; `POST /api/admin/text-config/test`, `/api/admin/image-config/test`, `/api/admin/video-config/test`; `POST /api/admin/text-config/models`; existing generation routes `POST /api/ai/chat`, `/api/ai/image`, `/api/ai/video` and `GET /api/ai/video/:id`.
- Verification evidence: `npm.cmd run build` passed with TypeScript and Vite; `node --test tests/uuid.test.mjs` passed 1/1 across native, partial, and missing Web Crypto; static order assertions passed for all four preflight paths; source contract scan passed for no `imageEndpoint`, `keyConfigured`, administrator key payload, shared-key wording, or image charge wording; `git diff --check` passed with only line-ending warnings in the shared dirty worktree.
- Residual risk: this worker did not run a real browser or production service by contract. The main acceptance thread still owns authenticated desktop `1440x1000` and mobile `390x844` visual checks, keyboard/focus behavior, actual user-key save/test responses, model discovery against a configured relay, and the complete shared test suite after all concurrent workers finish.
- Blockers: none.
