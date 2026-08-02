# AI Creation and Node Interaction Status

- Updated: 2026-08-02 15:58 +08:00
- Status: complete locally; unstaged, uncommitted, unpushed and undeployed
- Owner: commander/main thread; one worker at a time only
- Baseline: `77e8ceff63c49f9930e73bdb4f45cc6d9573e20a`, clean and equal to the current local origin tracking ref

## Completed

- Read the required recovery documents, all existing coordination status files, current Git state and the initial relevant source locations.
- Confirmed all five clipboard screenshots and the local AGPL reference repository exist.
- Confirmed current hotspots: `CanvasNodeView`, connected generation context, image preview/URL input, `NodeToolbar`, node resize CSS, global font stack, draft import and the separate Dock image import.
- Registered the goal, success criteria, bounded steps and recovery instructions in repository documents before implementation edits.
- Fresh baseline `npm.cmd test` passed all `40/40` tests; the only current worktree changes are the new goal and status records.
- Recovered the active goal tool state and confirmed implementation files remain untouched.
- Inspected screenshot 1: it establishes a compact AI creation card with a clear header drag surface, structured prompt/reference/settings hierarchy, compact media/model controls and a stable bottom generation action.
- Inspected screenshot 2: it requires one consistent local system sans-serif stack for Chinese, Latin text and form controls. Current CSS leaves native `select`/`option` typography outside the inherited control rule.
- Mapped the reference typography baseline to its application-level SF Pro/PingFang/Microsoft YaHei/Helvetica Neue stack without introducing a remote font dependency.
- Added a focused typography contract test, confirmed it failed against the previous CSS, then unified the local system font stack and native `select`/`option` inheritance in `src/styles.css`.
- Started the typed-context and top-import implementation without reading another screenshot. The local reference classifies connected resources before prompt assembly; current code instead accepts `content/prompt` from every non-image node.
- Resumed the active goal without opening an image, browser, or development server. Confirmed the current worktree contains only the expected goal implementation and documentation changes.
- Confirmed the next independent defects in the actual code: image URL inputs always remain visible, resized image previews are capped at 300px, and text/note/AI editable controls leave no clear drag surface.
- Added failing contracts for ready-image URL hiding, locked/free image fill and text/note/AI drag surfaces, then implemented all three without changing the unresolved image-toolbar placement.
- Ready image previews now hide their URL editor, including internal `data:` images; failed external URLs remain editable. Locked image resize contains the image, while free resize fills the node.
- Added a 36px `GripHorizontal` drag surface to text, note and AI nodes; existing textareas, selects and action controls retain `nodrag` behavior.
- Continued without opening an image, browser, or development server. Compared the current AI node structure with the local reference component and confirmed screenshot 1's already-recorded hierarchy can be implemented without waiting for screenshots 3-5.
- Bounded this batch to the existing `336x320` AI node: a recognizable drag header with the mode switch, explicit prompt/context/settings sections, and a bottom action that cannot be displaced by the prompt area.
- Added the failing screenshot-1 structure contract, then implemented a 44px title/mode drag header, elastic prompt section, typed connection summary, fixed settings section and stable bottom generation action.
- Preserved existing text/image/video fields and relay calls. The connection counts are ephemeral live-node data and are not added to saved canvas documents.
- Added a `300x280` AI minimum and normalized older server/draft dimensions before both display and undo-history capture, preventing legacy small nodes from clipping the new card.
- Corrected the screenshot workflow after the user's clarification: the one-original-image-per-turn rule controls context size and does not require a repeated permission phrase. No image was viewed while updating this rule.
- Completed the five original-screenshot reviews one image per turn. Screenshots 3-5 establish a node-local image toolbar that follows node/canvas geometry, eight-way image resizing, and explicit drag surfaces with `grab`/`grabbing` feedback while controls remain isolated from node dragging.
- Recovered from the durable goal without viewing another image. Fresh focused baseline remains `8/8`; the actual worktree still contains only the expected goal implementation and recovery records.
- Located the remaining implementation defect in the current CSS: desktop and mobile overrides force `.node-toolbar` to fixed application coordinates, defeating React Flow's node-relative `NodeToolbar` transform. The current drag surfaces also are not yet assigned as each node's React Flow `dragHandle`.
- Completed the remaining implementation: node-local clamped image toolbar, self-scrolling toolbar contents, automatic below-node placement near the canvas top edge, eight-direction resize controls, explicit React Flow drag handles, pointer isolation, and top import classification.
- Re-ran the complete suite against the final implementation; all `50/50` tests pass and `git diff --check` reports no whitespace errors.
- Continued browser acceptance on the isolated `3113` instance without opening any original image. The image settings dialog fits fully inside the active canvas, the document has no horizontal overflow, and panning moved the selected image node and its toolbar by the same `(-90, -60)` delta with effectively zero center error.
- Verified zoom following from `114%` to `68%`, free-width resizing, locked corner resizing with aspect-ratio drift below `0.0001`, and eight visible edge/corner resize controls.
- Established real note and image connections into the AI node; image mode displayed `1 段文本 · 1 张图片` and exactly one typed reference thumbnail.
- Completed mobile `390x844` acceptance: the toolbar remained node-local and clamped near `8..386px`, its own scroller reached `413/417`, the settings panel stayed visible, the AI header drag moved the node about `(80, 67)`, and the page had no horizontal overflow.
- Found and fixed a final `1280x720` defect where the bottom canvas Dock could cover the settings action. Settings placement now avoids the Dock and the panel scrolls internally in short viewports; fresh-build desktop and mobile acceptance passed.
- Deleted isolated canvases, stopped port `3113`, removed its verified temporary database directory, reset the browser viewport and closed the isolated tab. Real `3102/5182` remained healthy.

## Next

1. No implementation or acceptance work remains for this goal.
2. Commit, push or deploy only under a separate user instruction.

## Blockers

- None.

## Verification

- `git status --short --branch` showed a clean `codex/infinite-canvas` tracking branch before these documentation-only goal records.
- Fresh baseline `npm.cmd test` passed `40/40`.
- Screenshot 2 was read as the only original image in its turn; no derived image was created or read.
- Focused `node --test tests/ai-creation-contract.test.mjs` passed `1/1` after first reproducing the missing typography contract.
- `npm.cmd test` passed `41/41`; `npm.cmd run build` passed with `index-Cyfjpwsl.js` and `index-CMxPRRkJ.css`; `git diff --check` passed with existing line-ending warnings only.
- The previously completed typed-context/import batch passes focused `4/4`, complete `44/44`, build assets `index-D0wZJ13A.js` and `index-CMxPRRkJ.css`, and `git diff --check` with existing line-ending warnings only.
- The current interaction batch first reproduced three failures, then passed focused `7/7`; complete `npm.cmd test` passed `47/47`.
- `npm.cmd run build` passed with `index-BPmD4OST.js` and `index-BicSWAfa.css`; `git diff --check` passed with existing line-ending warnings only.
- The screenshot-1 AI-card contract first failed against the flat control stack, then focused tests passed `8/8`; complete `npm.cmd test` passed `48/48`.
- Final build for this batch passed with `index-Bewf-R0A.js` and `index-BSlOJq65.css`; `git diff --check` passed with existing line-ending warnings only.
- No image, browser or development server was opened in this implementation turn.
- The rule-clarification turn also opened no image, browser or development server and made documentation-only changes.
- Post-screenshot recovery focused baseline: `node --test tests/ai-creation-contract.test.mjs` passed `8/8` at 14:00 +08:00.
- Final focused contract passes `10/10`; final complete `npm.cmd test` passes `50/50`.
- Desktop browser geometry at `1440x1000`: active canvas `x=280..1440`; settings dialog `x=1147.93..1399.93`, `y=334.23..874.23`; document `scrollWidth=clientWidth=1440`.
- Desktop pan evidence: React Flow viewport changed from `translate(229.542px, 435.203px)` to `translate(139.542px, 375.203px)` while both selected image and toolbar moved by `(-90, -60)` and retained a center delta below `0.001px`.
- Final focused contract: `10/10`; final complete suite: `50/50`; final build: `index-BxkgO0oh.css` and `index-biUS_uuq.js`; final diff check passed with line-ending warnings only.
- Default-height regression: at `1280x720`, the settings panel used internal scrolling, ended above the bottom Dock, and its `完成` action was the top hit target and closed the panel.
- Mobile regression: at `390x844`, document width stayed `390`, the toolbar occupied approximately `x=8..386`, the settings panel remained fully visible, and all eight resize controls were present.
- Cleanup check: `3113` had no listener and the verified temporary directory no longer existed; `3102` remained PID `28956` and `5182` remained PID `25148`, both returning HTTP 200.
- No real relay key, administrator password, ciphertext, Authorization header, `.env` content, production database or browser draft was read or changed.
