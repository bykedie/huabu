# Infinite Canvas Accepted Product Baseline

> Status: visual, relay/public-HTTP, web-only relay, AI creation, AI usability, and AI runtime baselines are accepted and delivered to GitHub through product commit `90e091a` and handoff documentation commit `44dd244` on 2026-08-02. The GitHub delivery closeout is complete; production remains a separate, not-yet-completed update.

## Objective

The existing infinite-canvas product was brought materially closer to the eight screenshots in `basketikun/infinite-canvas` while preserving account, administrator, relay, data, and commercial compatibility. Site billing and recharge UI are currently disabled by default, but their backend data model remains available for a later explicitly enabled release.

## Current Product Constraints

- Dark canvas is the default.
- Text, image, and video have independent administrator-managed relay addresses and open-model lists. Runtime authentication uses the authenticated user's encrypted key for the corresponding relay kind; administrators do not manage shared runtime keys.
- Account Security exposes exactly the user's text, image, and video key controls, configured state, and open models. It exposes no relay endpoint or key material.
- Administrator relay tests and text/image/video model discovery use the administrator's own saved user key for that kind. Discovery replaces the candidate list; models are exposed only after the administrator explicitly selects and saves them.
- Site billing defaults off through `SITE_BILLING_ENABLED=0`: text and video reserve/charge zero site points and billing/recharge UI is hidden. The existing ledger path remains available only when explicitly enabled; image generation remains zero site points in either mode.
- Text generation calls Responses first, parses `output_text` or nested output content, and falls back to Chat Completions only when the upstream returns 404 or 405. Both protocols explicitly request non-streaming JSON responses.
- Text-mode AI creation displays connected image counts/previews and may send at most four validated typed image references. Reference bytes never enter visible prompt text; Responses and Chat Completions use their respective multimodal content-block formats.
- Canvas Assistant keeps in-progress IME text DOM-owned until composition ends, so React does not rewrite the candidate value. Composition and Windows key code 229 never submit, ordinary Enter submits once, Shift+Enter remains a newline, and intentional repeated punctuation is preserved.
- The `h` panel does not configure text, image, or video relays. Relay addresses, upstream discovery, and open-model selection are web Operations responsibilities.
- Legacy administrator shared-key fields may remain only as inert additive-schema compatibility fields and must not become active credential sources.
- Image operations must remain functional: crop, split, upscale, replace, download, asset save, large preview, and ratio lock.
- Existing login-page left content must remain unchanged.
- Existing user data and drafts must remain compatible.
- Public non-secure HTTP must remain usable even when `crypto.randomUUID`, `crypto.getRandomValues`, or the page-level `crypto` object is unavailable.
- Upstream-controlled values must not reflect a user's key into responses, logs, audit entries, generation rows, ledger rows, cached results, or persisted media/task fields.
- Testing a newly entered text/image/video key verifies first, saves only after success, and refreshes configured state; a failed test never persists the key.
- Manual AI context edges are direction-independent and persist as `context`; automatic generated-result edges persist as `result` and cannot flow back into later generation context.
- When an administrator has not opened a model for the selected mode, the AI action remains actionable and reports the missing model explicitly instead of silently disabling itself.
- Formal canvases, assets, and media are server-side records. Browser localStorage is only a draft/idempotency/UI recovery layer.

## Acceptance Targets

- Top bar feels light, 64px high, and visually floats over the canvas.
- Left resource panel follows the reference 300px layout rhythm without creating a second permanent application sidebar.
- Bottom dock is a compact 56px icon tool surface with stable dimensions and tooltips.
- Bottom-left navigation is a compact 56px control group.
- Canvas background, grid, node surfaces, selection, hover, handles, and curves match the reference palette and proportions.
- Left and right node handles remain visible circular input/output markers with distinct colors and usable contrast in light and dark themes.
- Desktop and mobile layouts have no overlapping text, controls, panels, or node toolbars.
- No regression in opt-in billing compatibility, relay configuration, generation, draft persistence, or image tools.
- Desktop `1440x1000`, mobile `390x844`, and a genuine non-secure HTTP origin must pass without black screens, page-level horizontal overflow, console errors, failed requests, or external resources.
