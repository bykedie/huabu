# Relay Compatibility Status

## 2026-08-01 22:25 +08:00

- Status: in progress.
- Goal: fix production compatibility when an administrator enters an OpenAI-compatible relay origin without `/v1`, and correct image SSRF classification for IPv4-mapped IPv6 answers without allowing private, loopback, or reserved targets.
- Completed: reproduced the text failure without credentials. `https://www.bkbk.baby/chat/completions` returns the website HTML while `https://www.bkbk.baby/v1/chat/completions` is the authenticated JSON API. Confirmed the image error is thrown before upstream fetch by `validateImageRelayUrl`.
- Next: add failing integration coverage for root URL normalization and mapped public/private IPv4 classification, then implement the narrow backend fix.
- Blockers: none. The user-provided credential will not be written to source, tests, commands, logs, screenshots, or documentation.
- Verification: current branch and origin are clean at `fde4fb2e00d8a50dd15b1d691fa49bc304f23e38`; production health and root return 200 and production assets match that build byte-for-byte.

## 2026-08-01 22:34 +08:00

- Status: implementation complete; full gates in progress.
- Completed: text and image relay origins with a root pathname now normalize to `/v1`, while existing `/v1` and custom paths remain unchanged. Split IPv4 and IPv6 unsafe-address blocklists to prevent Node's IPv4-mapped matching from classifying every public IPv4 address as unsafe. Standard IPv4-mapped IPv6 values are reduced to IPv4 before applying the existing private/reserved rules.
- Security boundary: public IPv4 and public mapped IPv4 are accepted; private IPv4 and private mapped IPv4 remain rejected. NAT64, loopback, link-local, documentation, benchmark, multicast, reserved IPv4, and non-global IPv6 ranges remain blocked.
- Next: run the complete server/production/UUID suite, production build, syntax checks, diff check, and secret-pattern count; then perform a read-only diff audit before GitHub delivery.
- Blockers: none. Production still needs one additional user-run `h` option 5 update after the new fix is pushed.
- Verification: focused three-user-key/model-discovery integration passed 1/1, including root URL calls to `/v1/chat/completions` and `/v1/images/generations`, public/private IPv4, and public/private IPv4-mapped IPv6 cases. `node --check server/app.js` and `git diff --check` passed.

## 2026-08-01 22:42 +08:00

- Status: complete and ready for GitHub delivery.
- Completed: audited the final diff and confirmed the root URL change is limited to text/image relay origins whose pathname is exactly `/`; existing `/v1` and custom paths are preserved, and video path behavior is unchanged. The address-family split fixes public IPv4 handling in both image validation and video media validation without weakening any private/reserved range.
- Automated evidence: focused compatibility integration 1/1; complete suite 32/32; production build passed with `index-DDen9KmM.js` and `index-ZMfIRUE0.css`; four server Node syntax checks and `git diff --check` passed.
- Secret evidence: exact scans for every recognizable fragment of the credential supplied in the user report returned zero workspace matches. No real credential was used in a command, source file, test, screenshot, log, status file, or persisted fixture.
- Upstream protocol evidence without credentials: the root `/chat/completions` endpoint returns website HTML, while `/v1/chat/completions` returns the upstream JSON authentication contract. The same `/v1` prefix is the authenticated image-generation API surface.
- Next: create a normal commit, push without force, let the user run MobaXterm `h` option 5, and retest the already-saved text/image keys from the production Account Security drawer.
- Blockers: none for code delivery. The disclosed upstream credential must be revoked and replaced after verification because it appeared in the conversation.
