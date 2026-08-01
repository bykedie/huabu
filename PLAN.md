# Current Delivery Plan

1. Complete: added focused regressions for Responses-first text calls, restricted fallback, three relay model-discovery routes, empty model defaults, disabled site billing, hidden point/recharge UI, removed h relay entries, and click/touch/Enter canvas rename.
2. Complete: implemented one shared text-relay helper used by relay tests and runtime, while preserving idempotency, secret-reflection guards, timeout limits, and failure recovery.
3. Complete: generalized upstream model discovery to text/image/video using the administrator's corresponding saved user key; every new fetch replaces candidates and clears previous selections in Operations.
4. Complete: defaulted site billing off, retained the future billing data/code path behind `SITE_BILLING_ENABLED=1`, charged new text/video calls zero points by default, and hid web wallet/redeem/top-up/admin point surfaces.
5. Complete: replaced the top-right points button with the API-key/account entry and made canvas-name editing work by single click/touch, Enter, persistent save, and reload.
6. Complete: removed h items for text/image/video relay configuration while preserving safe update as item 5 and the remaining operations.
7. Complete: full `40/40`, build, four Node and four Shell syntax checks, diff/secret gates, desktop/mobile browser acceptance, cleanup, and durable-document synchronization passed.
8. Complete: reviewed and committed the feature candidate as `99926be16bf561cfdb1ddfe4d51eb6ce4d7936e4`, pushed normally to `origin/codex/infinite-canvas`, fetched, and verified local/remote full SHA equality before the documentation-only closeout.
9. Pending/user-operated: the user enters item 5 in the MobaXterm `h` panel; then verify deployed SHA, backup, database, health, model discovery, API-key entry, Agent/text/image/video generation, and rename persistence.

# Completed Visual Alignment Plan

> Archived as complete on 2026-07-31. A new accepted idea requires a new recoverable goal and plan.

1. Complete: Shell thread aligned canvas background, top bar, left resource panel, menus, and desktop/mobile shell spacing.
2. Complete: Controls thread aligned the Dock, zoom/navigation group, minimap placement, appearance popover, panel-open centering, and responsive overflow behavior.
3. Complete: Nodes thread aligned node surfaces, titles, selection/hover states, handles, resize controls, image/video previews, toolbars, settings geometry, and edge visuals.
4. Complete: Main thread reviewed the actual diffs, ran automated gates, and accepted desktop `1440x1000` and mobile `390x844` isolated browser scenarios with clean console/network evidence.
