# Infinite Canvas Accepted Product Baseline

> Status: visual baseline accepted on 2026-07-31; relay and public-HTTP baseline accepted locally on 2026-08-01. This file is not a standing implementation assignment. The 2026-08-01 candidate is not yet committed, pushed, or deployed.

## Objective

The existing paid infinite-canvas product was brought materially closer to the eight screenshots in `basketikun/infinite-canvas` while preserving the current account, points, recharge, redeem-code, administrator, text-relay, image-relay, and video-relay features.

## Current Product Constraints

- Dark canvas is the default.
- Text, image, and video have independent administrator-managed relay addresses and open-model lists. Runtime authentication uses the authenticated user's encrypted key for the corresponding relay kind; administrators do not manage shared runtime keys.
- Account Security exposes exactly the user's text, image, and video key controls, configured state, and open models. It exposes no relay endpoint or key material.
- Administrator relay tests use the administrator's own saved user key for that kind. Text model discovery uses the administrator's saved user text key.
- Text and video retain site-point billing. Image generation remains zero site points; `AI_IMAGE_BASE_URL` is only the server default/fallback address.
- Legacy administrator shared-key fields may remain only as inert additive-schema compatibility fields and must not become active credential sources.
- Image operations must remain functional: crop, split, upscale, replace, download, asset save, large preview, and ratio lock.
- Existing login-page left content must remain unchanged.
- Existing user data and drafts must remain compatible.
- Public non-secure HTTP must remain usable even when `crypto.randomUUID`, `crypto.getRandomValues`, or the page-level `crypto` object is unavailable.
- Upstream-controlled values must not reflect a user's key into responses, logs, audit entries, generation rows, ledger rows, cached results, or persisted media/task fields.

## Acceptance Targets

- Top bar feels light, 64px high, and visually floats over the canvas.
- Left resource panel follows the reference 300px layout rhythm without creating a second permanent application sidebar.
- Bottom dock is a compact 56px icon tool surface with stable dimensions and tooltips.
- Bottom-left navigation is a compact 56px control group.
- Canvas background, grid, node surfaces, selection, hover, handles, and curves match the reference palette and proportions.
- Desktop and mobile layouts have no overlapping text, controls, panels, or node toolbars.
- No regression in points, relay configuration, generation, draft persistence, or image tools.
- Desktop `1440x1000`, mobile `390x844`, and a genuine non-secure HTTP origin must pass without black screens, page-level horizontal overflow, console errors, failed requests, or external resources.
