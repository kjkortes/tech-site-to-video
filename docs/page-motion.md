# Duration-aware page motion

The approved transcript remains the master clock. Contextual spans now use one
continuous shot rather than repeated identical 4.5-second holds. Camera scale
remains one; `Shot.motion` stays `hold`. Document movement is a separate,
deterministically derived `Shot.walkthrough.pageMotion`:

```ts
{
  kind: 'slow-scroll',
  startY, idealEndY, endY, minY, maxY, sectionEndY,
  holdIn, motionDuration, holdOut, easeDuration, reason
}
```

Coordinates are native CSS pixels from the document map. The LLM's choice schema
cannot supply them. The recorder remeasures the same section after page layout
and promotional code suppression, then reduces travel if necessary. A missing
section fails capture; a collapsed corridor becomes a reported static hold.

## Selection and corridor

- Beats under 3.5 seconds stay still. Longer contextual spans may drift when
  there is at least 65px of useful room and at least 1.6s for movement.
- Dense prose that already fits the usable frame stays still for inspection.
- Intro/overview and feature content can move. Media, exact cutaway returns,
  and the final caveat/payoff remain still by default.
- The corridor starts at the active section. Total displacement is capped at
  28% of viewport height and 45% of the caption-safe focal height.
- Tall sections retain a full viewport before the next section boundary.
  Compact sections retain at least 70% of their height and at least 320px of
  relevant context, allowing a small reframe of lower supporting material.
  Other material can already be visible lower in a full page viewport; the
  movement never advances the primary viewing position into the next section.
- Horizontal feature cards use their own bottom edges, not the next card's top.
- The nominal speed varies with text density from 30 to 65 CSS px/s. Corridor
  constraints can make it slower; below 12px/s the planner chooses a hold.

## Timing and execution

Each drift begins after any section-navigation transition plus a 0.65s arrival
hold. It ends with at least 0.6s of stillness. Movement lasts at most eight
seconds, and uses the available transcript span and remaining runtime budget.
Acceleration and deceleration are cosine velocity ramps lasting the smaller
of 0.45s and 18% of movement duration. The middle has constant velocity.
Peak speed is `distance / (motionDuration - easeDuration)`.

The recorder uses one `performance.now()` clock and `requestAnimationFrame`,
computing absolute Y from elapsed time. Instant scroll positioning is used
for these tiny interpolated frame updates and discarded setup, never as a
visible destination jump. It does not use wheel events or browser inertia.

The walkthrough's exit state stores the end position plus a section-relative
offset, so following visits and cutaway returns restore the resulting framing. Actual
captured endpoints carry forward when live reflow reduces a planned drift.
Captions remain a separate fixed overlay at the existing bottom-center safe
zone. No screenshot zoom, page scale, sidebar policy, script approval, narration
approval, or source-media selection rule changes.

## QA

Plan validation runs before recording and in final QA:

- Warn about more than 4.8s of unchanged contextual footage during narration
  when useful local scroll room exists. Consecutive shot IDs or a moving opening followed by a frozen tail cannot conceal a
  dwell. Exclude media, returns, ending beats, and sections without useful room.
- Reject invalid/nonfinite corridors, out-of-section drift, missing holds,
  timing overflow, media given page motion, and speeds over 80px/s.
- Warn above 60% moving runtime; reject above 70%. The planner initially budgets
  58%, leaving room for later section navigation.
- Warn about three successive long drifts or a drift longer than nine seconds.
- Save actual scroll samples in `recordings.json` and check their bounds and
  forward progression. Report live corridor fallback. Scan planned moving
  footage for sustained freezes.

Capture, director, and map revisions invalidate old visual checkpoints while
preserving the approved narration and script.

## PhotoCraft regression

Run `npx tsx --env-file-if-exists=.env scripts/page-motion-preview.ts JOB_ID`.
It writes an isolated preview under `test-output/page-motion/jobs/`, reuses the
source script/audio/transcript, measures current geometry, and saves the
before/after shot report, recordings, composition, MP4, and QA report.

For the 44.902375s source regression:

| Beat | Before | After |
| --- | --- | --- |
| Intro, 0–7.505s | Repeated static framing | Hold, 320px drift, settle |
| Overview, 7.505–13.985s | Same static overview | Continue from prior framing, 76px drift, settle |
| PSD, 13.985–25.42s | Compact summary card | Remains still: insufficient relevant room |
| Adjustments, 25.42–33.925s | Repeated static feature section | Navigate, establish, 228px drift, settle |
| Caveat/ending, 33.925–44.902375s | Static page | Remains a stable ending |

Five continuous shots replace twelve repeated holds. Navigation plus slow drift
is 21.14s (47.1% of runtime). Actual captured endpoints match the planned
endpoints. The MP4 preserves the narration, normal scale, hidden GitHub sidebar,
code suppression, and fixed captions. Before/after contact sheets were inspected.

Remaining constraints: compact PSD proof stays static; this change does not
remap the approved script to a different source section or invent a proof
cutaway. Slow movement follows beat timing rather than aligning each paragraph
to an individual word. Live layout changes may reduce travel. Browser frame
scheduling can vary even though the time-to-position curve is deterministic.
