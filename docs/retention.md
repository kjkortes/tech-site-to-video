# Promotional walkthrough retention

This extends the existing transcript-driven director, section walkthrough, motion recorder and renderer. It preserves the script/narration gates, uploaded-audio path, native page scale, hidden GitHub sidebar, expanded README, fixed bottom-center captions, social safe zones and promotional code suppression. Director revision 7 invalidates old visual plans while retaining narration.

## What lost momentum

The previous 44.902375s PhotoCraft page-motion preview used the README for the entire runtime. The compact PSD summary remained unchanged for 11.435s. Adjustment narration used an 8.505s page shot despite an available screenshot. The last 10.977s remained on Get started. Its early page progression worked; missing evidence and payoff were the remaining weaknesses.

## Context and evidence

`product-media.ts` ranks a primary and secondary hero from source product UI/media. Eligibility considers dimensions, quality, confidence, source identity and recognizable product features; badges/logos are excluded. Broad product representation and entry-section association improve hero ranking. The inventory persists `heroAsset` and `secondaryHeroAsset` IDs.

Local section media remains first choice. A fallback overview must belong to the same source and page's introductory section, and share a concrete feature with the narration. Generic words such as editor, app, screenshot and workflow cannot alone justify it. Another section's specialized screenshot cannot be borrowed merely for variety. Installation instructions do not switch to overview media.

The PSD overview is explicitly `product-context`: it shows the layered editor while the README/cited narration supplies the benchmark result. It does not pretend that an editor screenshot demonstrates the 307/309 test itself.

A context prefix, introductory sentence or short feature label stays on the README. Word timestamps determine the evidence entry. When a feature phrase starts immediately, the media may own that complete span, retaining its section association in metadata; the old mandatory one-second prefix no longer blocks it. The same asset covers the entire supported phrase, including dependent explanations. Coverage validation rejects missing words, gaps and premature exits. Browser origins and forward section order remain represented and validated.

## Motion and ending

Long still product shots have optional `mediaMotion`, distinct from page movement and temporary detail crops. They establish wide for 1.5s, move gently and settle for 0.8s. Evidence approaches 1.04x; hero approaches 1.025x; QA rejects more than 1.05x or less than 94% visible source area. A verified inventory focal region can direct attention. Without one, the full UI remains the subject; coordinates are never guessed from prose. Animated product media plays without an added screenshot push. Short beats do not receive attention motion.

The final actual spoken takeaway selects the hero, using the same source and exact phrase timing. Caveat context precedes it. Installation/code instructions and caveat-only endings retain the context they require. A hero needs at least three available seconds; otherwise QA requests review instead of stretching audio. Model detail refinements cannot turn a calm promotional hero ending into a cropped inspection.

Intentional hero reuse is recorded and exempt from the diversity warning. Returning to the same image for product reveal, relevant proof context and final takeaway serves different narrative purposes.

## Retention QA

The final review records generic-page runtime, product-media runtime, hero runtime and longest unchanged page dwell during active VO. A warning starts above 4.8s. Adjacent identical views accumulate dwell across shot IDs; navigation and page drift reset it only while moving, so their still tails count. Silence is excluded. Product media and hero inspection are treated separately. A static page without useful relevant motion/media can remain, with a recorded hold reason.

Warnings cover missing available feature evidence, too-brief product coverage, three consecutive generic page shots, missing middle-third evidence, generic-page dominance, an inappropriate generic/weaker ending despite available heroes, a hero shorter than three seconds and unrelated retention media. These remain advisory; the existing evidence, coverage, continuity, motion and camera correctness rules still enforce errors. Page/media balance is a review signal, not a mandatory runtime percentage.

## PhotoCraft before and after

| Narration | Previous view | New sequence |
| --- | --- | --- |
| Identity, 0–7.505s | README with slow progression | Preserved |
| Broad capability, 7.505–13.985s | README | Full Great Wave editor, 6.480s |
| PSD, 13.985–25.420s | Static PSD card, 11.435s | Exact browser return, PSD context, Great Wave product context during the proof, 7.155s |
| Adjustments, 25.420–33.925s | Page drift | Feature context, adjustment screenshot for 6.667s |
| Caveat/takeaway, 33.925–44.902s | Get started, 10.977s | Caveat context, Great Wave hero from 39.680s for 5.222s |

The revised video spends 19.378s on page context and 25.525s on product media. Longest unchanged page dwell during active VO is 4.555s. Page movement/navigation totals 8.655s. These timings come from this approved transcript; none are planner constants or PhotoCraft-specific selectors.

## Verification and preview

150 tests pass, including A–F, word-aligned media ownership, duplicate-view dwell, silence, unrelated-source rejection, installation endings and motion bounds. TypeScript and diff checks pass. The existing HyperFrames composition check passed with no findings, using the unchanged 0.8.140 dependency. Pipeline QA passes at 98/100; retention is 100/100 with no warnings. The QA score reflects that automated pixel-semantic review is not configured. Representative PSD, adjustment and final hero frames and the contact sheet were manually inspected.

The original script, transcript and narration WAV are byte-for-byte unchanged. The preview is isolated at `test-output/retention/jobs/fbdb3db5-528e-4292-8cdb-a1c2a8af3258/final.mp4`; Studio runs at `http://localhost:3004/#project/composition`.

Reproduce with `PREVIEW_DATA_DIR=test-output/retention npx tsx --env-file-if-exists=.env scripts/page-motion-preview.ts SOURCE_JOB_ID`. Recheck an existing render with `npx tsx scripts/retention-review.ts PREVIEW_JOB_DIRECTORY`. The preview refreshes live geometry for narrated sections and tolerates unrelated, unused section changes. A missing narrated section remains an error.

Selection still relies on source descriptions, feature terms and capture quality rather than a general semantic vision classifier. Exact UI-region movement requires verified focal metadata. Landscape screenshots keep their wide layout, so tiny controls remain small. The PSD screenshot provides product context, not a recorded compatibility test. Narration with no suitable takeaway or very short spans can legitimately retain page context. Actual audience-retention improvement requires viewer analytics.

## Screenshot zoom stability correction

The first retention render used `zoompan` for the gentle screenshot approach. Its integer crop dimensions and chroma-aligned crop origins caused a stationary attention point to wobble by 2.119 output pixels. The still-frame review did not catch this temporal artifact.

The attention-motion renderer now uses an affine `perspective` transform with fractional source coordinates and cubic interpolation, in 4:4:4 before final delivery conversion. The source, scale limits, wide opening, settling hold, shot sequence, captions and audio timing are unchanged. A camera-render revision invalidates cached attention clips without invalidating browser recordings.

A decoded 120-frame stability regression checks a stationary focal target and the opening/ending holds. The corrected render measures 0.120px horizontal and 0.075px vertical focal spread, including H.264 encoding noise. All 151 tests pass. The corrected PhotoCraft preview is `test-output/camera-stability/jobs/bce47663-b146-4dd5-937d-4db3f2c74059/final.mp4`.
