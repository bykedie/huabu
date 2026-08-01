# Visual Alignment Specification (Accepted Baseline)

> Status: accepted on 2026-07-31. This file records the visual baseline; it is not an active implementation assignment.

## Objective

The existing paid infinite-canvas product was brought materially closer to the eight screenshots in `basketikun/infinite-canvas` while preserving the current account, points, recharge, redeem-code, administrator, text-relay, image-relay, and video-relay features.

## Current Product Constraints

- Dark canvas is the default.
- Text and video relay keep their existing administrator configuration and site-point billing. The server selects the image relay through `AI_IMAGE_BASE_URL`; each user supplies an encrypted API key, and image generation does not charge site points.
- Image operations must remain functional: crop, split, upscale, replace, download, asset save, large preview, and ratio lock.
- Existing login-page left content must remain unchanged.
- Existing user data and drafts must remain compatible.

## Acceptance Targets

- Top bar feels light, 64px high, and visually floats over the canvas.
- Left resource panel follows the reference 300px layout rhythm without creating a second permanent application sidebar.
- Bottom dock is a compact 56px icon tool surface with stable dimensions and tooltips.
- Bottom-left navigation is a compact 56px control group.
- Canvas background, grid, node surfaces, selection, hover, handles, and curves match the reference palette and proportions.
- Desktop and mobile layouts have no overlapping text, controls, panels, or node toolbars.
- No regression in points, relay configuration, generation, draft persistence, or image tools.
