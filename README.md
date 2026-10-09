# Frameforge · automated tech demo videos

A runnable local MVP of the supplied **Automated Tech Demo Video Generator** brief. Paste a public website or GitHub repository URL, review the generated or custom VO script, approve generated or uploaded narration, then let the worker produce a vertical MP4 for final review.

## Run

Requires **Node.js 22.12+**, FFmpeg/FFprobe with libass and libx264, Chromium, and the existing `kokoro-local-tts` service for generated voices. Uploaded voices can be used without running Kokoro; their alignment requires Python with `faster-whisper`. Ubuntu's standard FFmpeg package supports the default renderer.

```bash
npm install
cp .env.example .env
npm run setup:browser
```

Start Kokoro in a separate terminal:

```bash
cd /mnt/0A566812566800B5/GitRepo/kokoro-local-tts
./run.sh
```

Then start the web app **and** durable video worker:

```bash
npm run doctor
npm run dev
```

Open **http://127.0.0.1:3000**. `npm run dev:web` starts only the interface; `npm run worker` starts only the worker. Production: `npm run build`, then `npm start`. The studio detects missing worker/narration services and explains how to start them. If using an existing Chrome installation, set `CHROMIUM_EXECUTABLE_PATH` in `.env` instead of downloading Playwright's Chromium.

## Script and narration approval

**Start project** researches and explores the URL, generates a VO script, then stops at **SCRIPT_REVIEW**. Edit the text and **Save edits**, choose **Use my own script** and save it, or regenerate using the same research with optional direction. Regeneration feedback is interpreted by the configured model; source-excerpt mode remains deterministic. **Approve script** accepts the exact saved version and opens narration options; it does not start TTS or video generation.

Choose **Generate TTS** to use the existing configured Kokoro voice/settings, or **Upload & align narration** for WAV, MP3 or M4A (100 MB maximum, 30 minutes maximum). Both paths stop at **AUDIO_REVIEW**, with a player, real duration, narration source and approved script. Only **Approve & generate video** unlocks final directing, recording, composition, rendering and QA.

Uploads are stored locally, probed with FFprobe, and decoded to a canonical 48 kHz WAV. Local Whisper produces actual spoken words and timestamps; token alignment maps those words to the approved script's section/scene associations. It never invents a reading clock. The canonical audio duration, aligned clauses and actual word timestamps drive the complete video timeline and captions. Recognition wording is used for uploaded-audio captions; your exact approved script remains saved independently.

`NARRATION_PYTHON` selects a Python environment containing `faster-whisper`. If unset, the existing neighboring `../kokoro-local-tts/.venv/bin/python` is used when present, otherwise `python3`. `NARRATION_WHISPER_MODEL` defaults to `small` and also accepts a local model directory. The first invocation can download model weights; speech is processed locally. A missing model/dependency or unintelligible recording pauses the job with an actionable error; the original upload is retained for **Resume**. There is no estimated-timing fallback.

More than 25% normalized token edit difference triggers an explicit mismatch warning. Minor punctuation, case and small pronunciation/recognition differences are tolerated. Choose **Use audio transcript** (creates a new script version requiring script approval followed by audio approval), **Keep script and replace audio**, or explicitly **Proceed anyway & generate video**. Recognizer errors and differently paced speech can still shift clause boundaries; listen and review the transcript when warned.

Script history is stored in `script-versions/` with version, source (`generated`, `edited`, `user_provided`), creation/approval timestamps and content hash. Audio metadata and archived waveforms/original uploads live in `audio-versions/`. Job state and approval records use the existing atomic JSON/PostgreSQL store. Review states are excluded from both worker polling and Redis reconciliation; duplicate tasks cannot bypass the gates. Approval binds the script version/text, audio version/waveform and transcript hash. Reloading the studio restores the selected project and its saved review stage.

**Back to script** retains research, inventory and exploration, revokes approvals and marks narration stale. Saving changed text invalidates narration, timings, shots, recordings and render; previous versions remain archived. Reapproving an unchanged script can restore the same waveform to audio review, but never approves it automatically. **Regenerate → Visuals & edit** preserves approved script/audio. Human wording also survives capture/map upgrades; factual wording of human-authored scripts receives an advisory QA notice rather than being silently rewritten.

For promotional GitHub sources, both exploration and recording normalize the live repository layout before capture. Current `SplitPageLayout`/`PageLayout` components, legacy `Layout-main`/`Layout-sidebar` and semantic sibling geometry identify the right About/Releases/Packages/Languages pane. Its wrapper is hidden; grid/flex and main-column width limits are released so the README reflows normally. GitHub/README identity, font sizing, source proportions and the existing contextual camera remain intact. Detected sidebars that fail to free sufficient width produce a capture error instead of compensating with zoom. Other websites and developer/tutorial capture policies retain their original layout.

## Model and creative-direction controls

Default promotional VO writing now uses the retained research, ordered page sections, screenshot/demo descriptions and up to four actual media previews. It produces two internal story candidates, independently checks grounding and seven writing dimensions (hook, clarity, progression, visual support, differentiation, speech and density), and attempts up to two focused revisions when concrete weaknesses are found, stopping early when they are resolved. Grounding and source ownership take priority over a numeric score. Candidates can omit redundant optional sections while retaining the source-page introduction, selected differentiator and important caveat; the accepted outline follows the chosen script.

The target is 80–115 spoken words without padding. Short grouped feature statements establish capability; the narration then explains user consequences and builds toward an unusual differentiator and concise takeaway. Research/navigation/critique remain restrained; script writing uses the project's selected creative direction, model and reasoning effort. Model writing adds draft/review calls and may take longer than the former single draft. The existing timeout/retry handling remains in place.

The script-review screen includes a collapsible writing check, also saved as `script-quality.json` with candidate metrics, evidence-preview IDs, model settings and script version. Remaining editorial issues after the bounded revision are advisory for the human reviewer. Unsupported candidates cannot pass the grounding review. Saving manual edits removes obsolete automatic quality scores; it never rewrites the user's text. Regeneration feedback uses the previous saved script and retained research/visual inventory. Source-excerpt mode remains literal and explicitly marks creative review unavailable. These writing changes apply to new/regenerated scripts, preserving existing approval gates and approved narration.

Open **Studio settings → Default model & direction** to choose a GPT model, reasoning effort, and creative direction, then **Save defaults**. New videos inherit these settings. Expand **Video model** below the URL form to override them for a submission. In an existing project's Overview, expand the model settings and then use **Regenerate** (or **Resume** for a failed job) to apply new choices to the stages you rerun. Changing defaults does not change existing jobs.

The initial Codex defaults are **Codex default model**, **Medium reasoning effort**, and **Balanced creative direction**, unless overridden by `CODEX_MODEL`, `CODEX_REASONING_EFFORT`, or `LLM_CREATIVITY`. The dropdown reads visible, image-capable models and supported reasoning levels from the local Codex model catalog; it does not hard-code an aging list of model names. Open Codex to refresh its catalog, then reload the studio. A custom model ID remains available when the catalog is missing or a new model has not appeared yet; account availability is confirmed by Codex when used.

**Reasoning effort** is sent as Codex's `model_reasoning_effort` setting. **Creative direction** (Restrained / Balanced / Bold) steers script wording rather than pretending to be a Codex temperature knob. Research and QA remain evidence-driven at every creative setting. All model stages in a job use its saved model/effort. Research, mapping, navigation, visual selection and QA use precise task profiles; navigation always favors logical order. The Codex model and reasoning effort stay unchanged. Per-job settings are isolated even with concurrent workers; successful cached stages retain their previous outputs on scoped regeneration.

Saved defaults live in `DATA_DIR/model-defaults.json`, separated by provider; job snapshots live in the job payload (JSON or PostgreSQL). Web and workers must share `DATA_DIR`, as they already do for video artifacts. **Restore environment defaults** clears the UI defaults for the configured provider. Credentials, provider, and API endpoint remain server configuration. The existing OpenAI-compatible API path accepts custom model IDs and creative direction; API reasoning-effort controls and OpenRouter-specific model discovery are not implemented yet.

`npm run test:settings-ui` exercises the studio in Chromium against isolated HTTP fixtures while the web app is running on port 3000 (`STUDIO_TEST_URL` can override it). It checks defaults, reload, submission overrides, regeneration, supported efforts, custom IDs, reset, and mobile layout without creating real videos or changing workspace settings.

## What is implemented

- Next.js review studio with persisted projects, worker progress, playable preview, source evidence, timestamped script, inspectable **Shots** tab, QA report, approval/download, skipping, and scoped regeneration.
- Node/TypeScript pipeline: research → exploration → script → **script review** → narration choice → **audio review** → shot plan → clean recording → edit → QA → final review.
- Separate browser passes. Exploration saves screenshots and replay instructions; only the fresh recording pass becomes browser footage.
- Typed visual inventory treats each README screenshot, GIF, video, section, code block and demo target as an independent candidate. Original raster/media downloads are bounded and every redirect is checked; inaccessible/unsupported media use an element capture. Badges and small icons are filtered out.
- The guided walkthrough director first builds a DOM page map and ordered story outline, writes narration around section visits, then maps word timestamps to browser context and local cutaways. It optionally uses the configured Codex/API model with up to eight attached source image/code previews to refine focal regions without changing section visits or document order. Each persisted shot explains its purpose, asset, framing, motion, caption placement and selection rationale. Invalid model selections fall back to executable source-ranked shots.
- Every video opens on the source page: homepage hero, repository/README beginning, or documentation landing/title, according to source type. Context, product and detail framing fill the viewport with a small optional source identity. Media starts contained and wide. Explicit, temporary details support subtle pushes and source-anchored highlights after an establishing view. Developer/tutorial code close-ups capture the actual README DOM with syntax highlighting, line geometry and full overflow, then crop/pan across the relevant lines; generated code excerpts are a recorded last-resort fallback; diagrams reveal source-backed nodes and connections in sequence and require cited relationships and narrated labels. Camera motion is baked into independent clips, so FFmpeg and HyperFrames use the same treatments.
- Purposeful navigation scrolls for about 0.5–1.2 seconds between stored section locations, then pauses. Section-local cutaways return to the same context. Narrated visual coverage takes priority over browser/cutaway quotas. Each cutaway stores a complete exact spoken phrase, cited claims, source section and relevance reason. Word timestamps set entry (about 200ms early) and exit (about 400ms after the last word, within the available timeline). Forward order, media ownership, technical code context and return targets are validated. Source association is retained in metadata when narration starts directly on media; README insets are never composited into cutaways. Static context is allowed; changes in source, crop and motion are no longer forced for variety. Timing, readability, sources and safe captions remain checked.
- **Regenerate → Visuals** rebuilds direction, capture and editing while preserving research, script and narration. Legacy inventory is upgraded with matching scene identities retained. Older scripts are regenerated once for the concise connected story arc (typically 40–50s, with no required minute); already ordered scripts retain speech when still valid.
- Public-page research, including GitHub's rendered README and relevant documentation links. Every factual segment cites an exact excerpt and a discovered visual from the same source.
- Optional local Codex provider using your ChatGPT login, or an OpenAI-compatible API provider, for research, safe exploratory interactions, script writing, and an independent factual audit. Website text is treated as untrusted evidence.
- **Without a model**, the app works in conservative source-excerpt mode. This avoids inventing capabilities, but produces a less polished script. No fake model responses or placeholder videos are used.
- Kokoro uses `/api/jobs` with storyboard segments, polls a saved speech job ID, downloads the real WAV, and uses returned timestamps as the master timeline. There is no silent or synthetic fallback for a missing speech service.
- Independent deterministic Playwright/demo clips and camera-treated media clips are saved after each shot. Checkpoints match the complete shot signature. Replays try stored/semantic/text locators; failures retry only the shot, then report a capture failure in promotional mode; developer/tutorial shots may use a discovered screenshot and record the fallback reason. A missing clip preserves all surviving captures.
- FFmpeg assembles 1080 × 1920 / 30fps H.264 with AAC at 48 kHz. Captions stay in one lower platform-safe band (x96–852, y1344–1536), with a fixed anchor at (474,1512), 42–48px type and at most two lines. The rightmost 194px and bottom 346px remain clear for platform UI. Narrated focal controls are reframed above subtitles while the source fills the canvas; captions never move to the top and visual cuts never restart them. Word timing is used where available; sentence-timed proportional chunks remain the fallback. Narration is never retimed to fit footage.
- Every job also gets a portable **HyperFrames HTML composition** with local GSAP, copied media, captions, narration, and seekable timing. Set `VIDEO_RENDERER=hyperframes` to check and render that composition instead of the fast FFmpeg path.
- QA checks output existence, delivery streams, voice duration, resolution, black intervals, long silence, clip duration, long static sections, error-page titles, caption/focal geometry, evidence references, plan diversity, exact capture signatures and complete shot coverage, exact phrase-to-visual coverage, group readability, source-code fallbacks, source-type intro, visible source area, contextual/detail runtime balance and story progression. Clean capture rejects detected consent overlays. Model mode also checks factual entailment. Terse citations retain a missing literal antecedent only when it occurs in the same mapped source section, preventing ambiguous quotes from losing their subject. Media failures get one automatic repair pass.
- Local JSON snapshots are atomically replaced. Per-job leases prevent a worker and review action from writing simultaneously. Worker restarts reuse stage artifacts and completed clips. FFmpeg edits also checkpoint each assembled shot, so an edit retry reuses completed renders when source files and framing match. Provider/stage failures get one automatic retry and then an actionable saved failure.
- Optional PostgreSQL job persistence and BullMQ/Redis dispatch. Local disk remains the artifact store in both modes.

## Use your ChatGPT subscription through Codex

Install a current Codex CLI (the integration uses `--ignore-user-config` and `--ephemeral`), then run `codex login` and choose your ChatGPT account. `codex login status` should report **Logged in using ChatGPT**. The VS Code extension and CLI can reuse the same cached login.

Set in `.env` and restart the studio and worker:

```dotenv
LLM_PROVIDER=codex
CODEX_BIN=codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=180000
```

No `LLM_API_KEY` is needed for this mode. Requests use your included Codex allowance and its usage limits. `CODEX_MODEL` can select a model available to your account; leave it blank for Codex's default. `LLM_MODEL` applies only to the API provider. Leave `CODEX_BIN=codex` for automatic discovery: the app checks PATH, standard install locations, and the current Codex bundle in VS Code, Insiders, or Remote extensions. Discovery runs before each launch, so extension upgrades do not require changing a versioned path or restarting the worker. Older configurations pointing to a removed extension bundle also recover automatically. A custom absolute `CODEX_BIN` remains an explicit override; use a stable path for custom installations. Studio settings and `npm run doctor` show login readiness.

Each request starts an ephemeral Codex process in a temporary working directory, sends the task/evidence over stdin, validates its JSON response, and cleans up afterward. User configuration, plugins, shell, browsing, image inspection, and subagents are disabled for these requests. Codex handles its own saved login; the app never copies authentication tokens. ChatGPT auth is required and inherited API credentials are removed from the child environment. Missing login, usage limits, invalid responses, or timeouts surface as failures; they never switch to API billing.

Provider choices: `codex` uses the subscription, `api` requires `LLM_API_KEY`, `extractive` uses source excerpts, and `auto` preserves the original behavior (API when a key is present, otherwise excerpts). For the API provider, configure `LLM_BASE_URL` and `LLM_MODEL` as before.

New projects use the selected provider. Existing projects retain saved research and scripts until regenerated; choose **Full video** to redo research, or **Script & downstream stages** to rewrite narration using existing evidence.

See the official OpenAI documentation for [Codex authentication](https://learn.chatgpt.com/docs/auth) and [non-interactive requests](https://learn.chatgpt.com/docs/non-interactive-mode).

## Persistence and regeneration

Artifacts live under `data/jobs/<job-id>/`:

```text
job.json                       # local job state (PostgreSQL mode stores state in DB)
research.json                  # URLs, evidence text, claims and citations
inventory.json                 # scenes plus independent media/code/demo assets
assets/asset-*                  # original/captured source media
assets/director-asset-*.jpg     # previews attached to visual direction
exploration/scene-*.png
script.json                    # exact canonical VO text and current review/version metadata
script-history.json
script-versions/               # immutable saved script versions / approval snapshots
audio-versions/                # prior narration metadata, WAVs and original uploads
audio-input.*                  # authoritative current uploaded original
audio-transcription.json       # local ASR words and actual timestamps
tts-progress.json              # external Kokoro job ID for restart recovery
narration.wav
transcript.json
shot-plan.json                 # timed visual intent and selection rationale
director-report.json           # direction diagnostics and fallback notes
diversity.json                 # final pre-capture plan validation
coverage-report.json           # exact spoken phrases, claim/source support, visible ranges
retention-report.json          # hook, pacing, readable dwell and final payoff diagnostics
camera-report.json             # mode runtimes, zoom scale and visible source fractions
safe-area.json                 # shared caption/platform/visual bounds
page-map.json / story-outline.json / walkthrough-state.json
clips/001.webm / 001.mp4 ...    # independent browser/camera/generated clips
recordings.json                # signatures, trim points, raw clips, fallback reasons
render/progress.json           # independent FFmpeg edit checkpoints
captions.srt / captions.ass
composition/                   # standalone HyperFrames project + local assets
final.mp4 / poster.jpg
qa.json
```

Failed jobs stop at the failing stage and can be resumed after fixing the cause. Regeneration invalidates these stages and everything after them:

| Review action | First regenerated stage | Preserved work |
|---|---|---|
| Full video | Research | None |
| Script | Script | Research and exploration |
| Voice | TTS | Research, exploration, script |
| Visuals | Directing | Research, inventory, script and narration |

Approval is a stored human decision and exposes an MP4 download button. The app does not publish to any platform.

## Optional PostgreSQL + BullMQ

```bash
docker compose up -d
```

Set in `.env`:

```dotenv
DATABASE_URL=postgresql://frameforge:local-development-only@127.0.0.1:5432/frameforge
REDIS_URL=redis://127.0.0.1:6379/0
```

Then `npm run db:migrate` and `npm run dev`. API submissions are persisted before queue insertion; worker reconciliation enqueues jobs saved during a Redis outage. Workers renew queue and filesystem leases while media commands run asynchronously. Both app and workers must share the same artifact directory. The supplied Compose services are for local development.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run doctor
npm run test:e2e
npm run test:director                         # real visually rich GitHub + model/TTS
npm run test:vo                               # real PhotoCraft + LocalSend scripts; stops before TTS/video
npm run test:renderer -- <director-job-id>     # short alternate-backend render
```

The unit suite covers review-state enforcement, QA-gated approval, byte-range video streaming, safe artifact paths, cross-origin mutation rejection, fresh Redis identifiers on resume, private-address blocking, fabricated citations, missing/mismatched visuals, continuous audio-driven shot timing, caption timestamp carry, exclusive leases, and scoped checkpoint invalidation.

`test:e2e` starts an explicit local test website and uses **real Chromium, the configured Kokoro service, and FFmpeg**. It asserts MP4 streams, 1080 × 1920 resolution, a passing QA report, clean recordings without fallback, and edit restart without changing existing clip modification times. Outputs go to `test-output/smoke`, separate from studio projects. The test alone enables private URLs inside its own process; normal submitted jobs do not.

The HyperFrames composition can also be inspected directly:

```bash
npx hyperframes check data/jobs/<job-id>/composition --json
npx hyperframes preview data/jobs/<job-id>/composition --background
```

## Practical limits of this MVP

The 60-second length is a target, not a hard cut: video follows the actual narration length. QA marks durations outside 40–75 seconds for human review. Speech is never accelerated to fit footage.

Exploration is bounded to a handful of public pages, headings, individual media assets and two discovered demo probes, with optional model-selected read-only interactions. It does not yet implement HyperAgent/Hermes, arbitrary application input, CAPTCHA solving, authentication, vision-based locator recovery, or deployment of GitHub repositories. Remote non-GET requests and form submissions are blocked to keep exploration read-only; some interactive demos therefore fall back to documentation or screenshots. An inaccessible site fails clearly instead of generating a misleading demo.

Pixel-level semantic vision QA is not implemented. The director can inspect attached source images, but this is not a claim that the finished video received a vision audit. The quality report explicitly marks frame meaning for human review. Error detection currently uses HTTP responses and page titles, freeze detection flags static sections as review warnings, and caption validation checks timing/length and planned focal geometry rather than every rasterized pixel. A QA percentage is the share of checks passed, not a claim that a vision model graded the video. The final human review remains necessary.

Diagram planning is intentionally conservative: labels must occur in narration and edges must cite an exact researched quote; unsupported diagrams are rejected in favor of source assets. Native repositories are not built or installed. Authenticated demos, DRM/streaming video and arbitrary remote application input remain outside the automated capture scope.

AI quality and GitHub/site variability require broader real-world evaluation. The default renderer and local pipeline are covered end to end, and a short HyperFrames composition has been checked and rendered. AI providers require a ready Codex ChatGPT login or API endpoint; Redis and PostgreSQL require their configured services. S3 storage and automatic publishing are future work.

The app binds to loopback and is intended for a trusted local workspace. It has no multi-user authentication. Do not turn this into a public service without authentication, quotas, sandboxed browser egress, and stronger storage isolation. URL validation rejects private/loopback/link-local addresses and checks browser requests and redirects, but DNS validation alone is not a hardened defense against DNS rebinding.

## Implementation references

[Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Playwright video lifecycle](https://playwright.dev/docs/api/class-video), [BullMQ worker locks](https://docs.bullmq.io/guide/workers/stalled-jobs), and [HyperFrames CLI](https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md).

`tsx --env-file-if-exists=.env scripts/presentation-smoke.ts <completed-director-job-id>` creates an isolated new PhotoCraft sample with GPT-6 Sol / High / Balanced, reusing verified research but refreshing source captures, story, narration and presentation. It does not change studio defaults or the original job. This is a diagnostic fixture, not a product-specific directing template.

### Contextual promotional walkthrough

New jobs default to `contentMode: "promotional"` (software discovery). The jobs API also accepts `"developer"` or `"tutorial"` for intentional code walkthroughs. Promotional mode blocks code assets in the director, recorder and render gate, hides browser code blocks, and refuses unchecked screenshot fallbacks that could reintroduce code or README galleries. Research and code extraction remain available for other modes.

The camera has three modes: `walkthrough` (default native page), `media` (contained full source), and `detail` (temporary, explicitly narrated inspection). The browser uses an actual 1080×1920 portrait viewport; responsive sites choose their own layout. GitHub keeps its native README typography and layout. There is no shell, reserved header, forced DOM enlargement, automatic cover scaling, edge smearing or default camera motion. A landscape screenshot is fit-width above the fixed caption band, preserving its entire source before any detail. Empty space is acceptable when it preserves context.

Detail requires an exact narration phrase, inspected source focus and camera reason. The default push is 1.08× and the hard maximum is 1.12×. A requested long detail is split into at least 2.5 seconds wide → at most 3 seconds detail → at least 2.5 seconds wide, preserving the same asset, narration support and timings. Edge controls may be shifted modestly into the platform-safe region. Every cutaway retains its exact page return target; the next visit returns there before scrolling onward. Static views and repeated source compositions do not require artificial variation. Direct/raw media and exact-element capture remain preferred; no README origin strips are composited into cutaways.
The reusable safe-area preset reserves the rightmost 194px (18%) and bottom 346px (18%) for platform UI. Captions always use the fixed lower band at x=96–852, y=1344–1536 (70% width; 70–80% height), with a bottom-center anchor at (474,1512), at most two lines and 42–48px type. Full-bleed background pixels may extend beneath UI; precise narrated controls are reframed into x=24–862, y=108–1316. Layout QA checks scale, focal geometry, caption bounds, content policy, media isolation and word-aligned support coverage. Platform overlays vary; these are conservative defaults, not per-device guarantees.

Story selection favors immediate identity, visible proof, escalation, one unusual differentiator, a caveat and a product payoff. It drops installation lists and protocol trivia, and targets an earned 40–50 seconds rather than a fixed minute. Source order, local claim/media ownership and browser return destinations remain enforced. The final takeaway preserves the natural source walkthrough instead of forcing an extracted product bookend. Shot state records the spoken beat, rationale, focal area, duration and entry/exit destinations.

Camera QA rejects an asset/close-up intro, automatic page/media zoom, detail without an immediate establishing view or return, unmentioned detail, detail over 4.5 seconds, scale above 1.12×, less than half the source visible, or detail exceeding 35% of runtime. It reviews detail above 20% and page context below half the runtime without manufacturing zoom to meet a quota. `camera-report.json` saves duration-weighted mode ratios, scale and visible-source fractions.

Verification helpers: `npx tsx --test tests/camera-policy.test.ts tests/fullbleed.test.ts` covers contextual camera rules, pixel isolation, safe focal framing, code rejection and exact-element extraction. `npx tsx scripts/contextual-preview.ts <completed-job-id> [--inspect-detail]` creates an isolated preview from existing research, narration timings and source assets; the original job is preserved. The optional inspection reuses a previously inspected focal region only when an associated feature is named by narration. `npx tsx scripts/renderer-smoke.ts <preview-job-id>` checks the alternate HyperFrames backend.

`npx tsx scripts/approval-ui-smoke.ts` checks editable/reload-safe review screens, regeneration feedback, custom script, voice selection, upload, stale narration and mobile layout against isolated fixtures. `npm run test:e2e` explicitly approves both gates in its test-only harness. Set `SMOKE_REGENERATE=true` to exercise regeneration/editing; set `SMOKE_AUDIO_SOURCE=<completed smoke job ID>` to exercise a custom script plus real local transcription of uploaded voice. Production workers never use the test approval driver.
