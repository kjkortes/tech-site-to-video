# Guided walkthrough director

The document is the backbone of the edit. Individual media is a contextual cutaway, rather than a global pool used to change visuals for each sentence.

## Data and sequence

Research keeps source-backed quotes. Exploration builds `page-map.json` from the actual README/article before generic page containers. Each section retains its heading, hierarchy, document order, selector, page positions, direct text, paragraph/code anchors and independent asset IDs. Each screenshot in a grid is still downloaded separately. A gallery cell/figure with one heading owns its media even when the image comes before that heading; other media belongs to the nearest preceding heading. Downloads, browser guards, demo probing and fallback captures remain bounded.

`story.ts` associates exact normalized quotes with sections and selects up to seven useful visits. The LLM can select visits; code preserves page and DOM order. `story-outline.json` is saved before narration. `script.ts` writes one segment per visit with only that visit's evidence. The first spoken sentence identifies the product immediately: “This is [PRODUCT], [supported explanation].” The final visit ends with a brief sourced takeaway/caveat. Order, evidence ownership and the product-first opening are validated.

TTS words and sentence timestamps are the master timeline. `walkthrough.ts` creates section visits with browser context, an optional local media cutaway, and a return. The opening uses actual product media for at most two seconds before page context. A short final product payoff can reuse that visual without navigating backward. Within longer sections, later browser shots can move forward to the paragraph currently narrated; this avoids holding installation code while describing a later status paragraph. Camera hold is a valid default.

Every shot carries `walkthrough`: visit ID, active location, role, previous/next browser location, return target and optional transition origin/duration. `walkthrough-state.json` adds the spoken words, selected visual, visual's owning section and reason. Full shot intent is still persisted in `shot-plan.json`.

The model refines only hook/cutaway/ending slots. It cannot replace section context or reorder navigation. A cutaway must belong to the active section or a nested subsection (the introduction is not allowed to own the whole document). Actual GIF/video playback, enlarged images, crops/highlights, source-code excerpts and cited diagrams remain available. Technical narration and prior browser context are required for code. Feature cards remain an executor fallback, not an automatically selected variety tool.

## Capture, edit and validation

Clean independent browser clips replay selectors → semantic headings → stored positions. A visible scroll starts at its stored previous section/paragraph and eases to the actual destination for roughly 0.5–1.2 seconds, at most two seconds. Return clips restore the browser location. Exploration recordings never become footage. A failed shot retries independently; successful captures and edited clips retain their signature checkpoints. Post-production camera treatments, both renderers, safe captions and AAC 48kHz delivery are retained.

`walkthrough-report.json` reports continuity and browser/cutaway duration. Typical plans aim for 60–75% browser context, with source-dependent exceptions. Hard checks reject unknown locations, reversed traversal, missing context before cutaways, foreign media, lost return targets, unintroduced/unrelated code, invalid scroll origins, long cutaway runs and plans dominated by cutaways. Timeline, source relevance, image resolution, captions and media QA are also retained. Purposeful repeated context/static holds are allowed; diversity no longer forces alternating sources, framing or motion. Explicit scroll shots stay under three seconds; transition motion is counted by its actual duration and the scrolling budget is relaxed to 35%.

Research, DOM mapping, navigation, visual selection and QA use restrained/high-precision task profiles. Script wording uses the job's selected creativity. Motion advice stays balanced. Codex keeps the job's model and reasoning effort; profiles change instructions, not model intelligence. The API path uses task-specific sampling while preserving the same schema/evidence checks.

Legacy inventories are refreshed while retaining matching scene identities. A pre-walkthrough script must be regenerated once because its arbitrary narration order cannot support forward navigation. Current ordered scripts can be rebound to refreshed section metadata and retain their existing speech when still valid. Successful upstream stages are reused.

## Limits

The map covers up to forty visible headings per explored page and up to eighty paragraph/code anchors per section. Exploration is read-only, public, and bounded; authenticated apps, native builds, CAPTCHA and DRM are not automated. Semantic interpretation of ambiguous sections/media remains approximate. Custom JS layouts without headings have a single introduction visit. Original unavailable animations become screenshot fallbacks. Final pixel-level semantic QA remains a review warning. Browser clips are independently captured at consistent locations rather than one persistent browser session, so volatile/dynamic UI may differ between clips.
