# Audience value in short promotional VO

The editorial pipeline keeps the product thesis, but now evaluates whether its evidence earns time for a general tech/software viewer. Research still retains implementation evidence for developer and tutorial modes. No PhotoCraft-specific facts or wording are encoded in production selection.

## Investigation

The exact old PhotoCraft script is stored in `data/jobs/4b1b2ac6-e821-4e3e-a2e8-0dff30004f16/script.json`.

Its CPU/GPU cross-check claim (`claim-12`) was classified `CORE_PROOF`, with thesis contribution **4/5**, because it substantiated the native implementation pillar. It also appeared in `strongestProof`. The old outline used thesis contribution plus a two-point strongest-proof bonus, giving the “Under the hood” visit **6**, without evaluating audience payoff or specialist complexity.

The byte-identical claim (`claim-11`) was classified `CAVEAT`, with thesis contribution **4/5**. It belonged to the selected PSD section alongside the valuable 307/309 result, so the writer received permission to narrate both. The main caveat brief also bundled byte identity and imperfect test coverage with early-alpha readiness. Nothing distinguished practical readiness from technical nuance. The critic rated thesis fidelity **5/5** and had no audience-value dimension; it suggested the awkward capability/ending wording as optional cleanup.

## Implementation

- `audience-value.ts` supplies a validated assessment per claim: audience relevance, understandability, visual support, novelty, user value, technical complexity and runtime cost, each 0–5. Evidence kind distinguishes user capability, engineering validation and implementation detail. Caveat impact distinguishes readiness, practical material limits and technical nuance. `essentialForAudience` allows implementation details that explain the product's defining value.
- Audience value = `0.3 × relevance + 0.2 × understandability + 0.3 × user value + 0.2 × novelty − 0.15 × complexity − 0.1 × runtime cost`, clamped to 0–5.
- Promotional eligibility preserves identity, normally requires audience value ≥2.6 and understandability ≥3, and filters technical nuances and low-value internal evidence at the **claim** level. Selecting a useful section no longer grants narration access to its unrelated micro-caveats.
- Beat score = `thesis contribution × audience value × visual support / 5`, plus a one-point strongest-proof bonus. Distinct core-capability coverage displaces redundant proof. Media availability cannot rescue ineligible evidence. Visual support here means whether the fact can be illustrated; real assets are still chosen after visits.
- The outline keeps one main practical caveat, prioritizing readiness. Additional material caveats survive when classified as essential to understanding the product. The writer must cite selected caveats even when they share the introduction with identity evidence. High-value numeric capability ratios receive a preference for at most one result; counts of stars, commands or arbitrary implementation metrics do not receive this preference.
- The writing brief supplies audience assessments, eligibility of omitted evidence and preferred numeric proof. The promotional writer translates technical facts into user consequences only when its assigned quotes explicitly support those consequences. It prefers direct capability language and a core takeaway with a concise caveat.
- The model critic scores `audienceValue` independently of thesis fidelity. A score ≤3 triggers revision and cannot be outweighed by perfect style scores. Deterministic checks flag low-value evidence, specialist density without payoff, stacked caveats, vague ambition endings and omitted selected numeric proof. Grounding remains a separate acceptance requirement.
- A final takeaway can cite already narrated identity/core facts through separate `takeawayClaimIds`. The validator restricts these to the final segment, the same source and facts cited in earlier retained segments. The critic receives their exact quotes separately. Local section citations retain their existing ownership checks. This lets the ending restate the core significance without inventing facts or moving new evidence between sections.
- Developer mode retains implementation evidence and receives a policy for architecture, protocols, validation and tradeoffs. Tutorial mode receives a policy for reproducible steps, commands, code and prerequisites. Promotional technical-density checks do not apply to either mode.
- Editorial revision is **2**, story revision **6**, writing-quality revision **3**. Existing generated scripts refresh through the established revision path; user-authored wording retains the existing preservation behavior.

## Verification and limits

Regression tests cover PhotoCraft, deep LocalSend documentation, colocated proof/caveats, strongest-proof bonuses on low-value engineering claims, mode-specific selection and writing, independent audience-score revision, grounding rejection, optional differentiation, numeric proof and natural technical language with an explicit payoff.

The model-based analysis is semantic; the extractive fallback uses conservative lexical heuristics and cannot judge every unfamiliar domain. Complexity/runtime scores are editorial estimates, not measured TTS duration. Visual support scoring does not establish that a screenshot proves a capability. Numeric-ratio detection currently expects digits. The model critic still checks actual assigned quotes independently.

Revision remains bounded to two attempts. Grounding failures reject generation, while unresolved editorial weaknesses remain advisory at human script review. No speech or video is generated before approval.

The live semantic editorial calls timed out at 180 seconds and recorded extractive fallback briefs. The real writer and critic still ran against captured source quotes and available media. An initial live draft dropped useful numeric proof; a follow-up added its selection preference and omission check. Another live attempt was rejected for grounding because its final takeaway restated earlier facts without separate citations; the final-takeaway citation path addresses that failure while preserving source checks.

## Final results

- `npm test`: **120/120 pass**. The first suite run hit an existing browser screenshot failure in “all director treatments render real clips, retain captions, and retry only failed captures”; its isolated retry and subsequent full-suite runs passed.
- `npm run typecheck`: pass. `git diff --check`: pass.
- PhotoCraft: **101 words**, thesis fidelity **5/5**, audience value **5/5**, quality status **checked**, no remaining issues. The exact captured job supplies both the old and new facts. Final identity/workflow reprise cites `claim-1` and `claim-4` separately; the local alpha caveat cites `claim-14`.
- LocalSend: **82 words**, thesis fidelity **5/5**, audience value **5/5**, quality status **checked**. Deep protocol, certificate, CLI and Flutter/build documentation remains available but is omitted from VO. The draft still enumerates platforms; further shortening that list is an editorial option.
- Both isolated jobs remain at **SCRIPT_REVIEW**. No narration or video was generated. The final PhotoCraft example exercised current scoring, preference checks, real model writing/critique, citations, persistence and review gating; it reused the recorded extractive brief after the semantic editorial timeout.

## PhotoCraft: old VO

This is PhotoCraft — an open-source, offline, native image editor rebuilding Adobe Photoshop through a clean-room implementation in pure Rust. The ambition includes layers, masks and real PSD files.

Adjust Levels or Curves, then mask, reorder or disable those adjustment layers. Your original pixels stay untouched, so you can keep revising.

PSD tests show matching renders after opening and re-saving 307 of 309 files. Those saves aren't byte-identical, though.

Underneath, the GPU canvas renderer is tested against a CPU reference.

It's early alpha, not yet a daily professional Photoshop replacement. I'd explore it for that ambition: rebuilding the layered editing workflow.

## PhotoCraft: new VO

This is PhotoCraft — an open-source, clean-room reimplementation of Adobe Photoshop, rebuilt in pure Rust as a native image editor that works offline.

You can open, edit and save layered Photoshop documents. Re-saving preserved their appearance in 307 of 309 PSD test files.

Change Levels or Curves, then mask or switch off those adjustments. Your original pixels stay untouched.

Filters on smart objects stay editable too: change, hide or reorder them later.

It's early alpha, so it isn't ready to replace Photoshop for daily professional work. The draw is an open-source, offline rebuild of that layered editing workflow.

The new draft replaces CPU-reference validation and byte identity with revisable editing capabilities, keeps the numeric PSD result scoped to test files, and closes on the layered editing thesis with one readiness caveat. Smart selection and automation are optional; this version does not force either into the story.

## LocalSend: new VO

This is LocalSend — a free, open-source app that shares files and messages with nearby devices over your local network, without needing internet.

You can share across platforms with encrypted communication, without depending on a third-party server.

It supports Windows, macOS, Linux, Android, iOS, and Fire OS, bringing phones and computers into the same sharing workflow.

If transfers aren't working, you may need to adjust your firewall. The appeal is straightforward: nearby sharing that keeps the handoff on your local network.

## Saved artifacts

- PhotoCraft: `test-output/audience-photocraft/comparison.md`, isolated job `b9a7ea3d-e8a3-488a-9e33-2c1121fa57fe`.
- PhotoCraft/LocalSend initial full-pipeline runs: `test-output/audience-value/comparison.md`.
- Final test log: `test-output/audience-value-tests-final.log`.
- Final writer/critic run: `test-output/audience-revision.log`; reproducible runner: `test-output/audience-revision.ts` (uses the isolated captured job and the configured model login).
