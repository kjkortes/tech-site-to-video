# Frameforge · automated tech demo videos

A runnable local MVP of the supplied **Automated Tech Demo Video Generator** brief. Paste a public website or GitHub repository URL, let the worker produce a narrated vertical MP4, then approve, regenerate, or skip it in the studio.

## Run

Requires **Node.js 22.12+**, FFmpeg/FFprobe with libass and libx264, Chromium, and the existing `kokoro-local-tts` service. Ubuntu's standard FFmpeg package supports the default renderer.

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

## Model and creative-direction controls

Open **Studio settings → Default model & direction** to choose a GPT model, reasoning effort, and creative direction, then **Save defaults**. New videos inherit these settings. Expand **Video model** below the URL form to override them for a submission. In an existing project's Overview, expand the model settings and then use **Regenerate** (or **Resume** for a failed job) to apply new choices to the stages you rerun. Changing defaults does not change existing jobs.

The initial Codex defaults are **Codex default model**, **Medium reasoning effort**, and **Balanced creative direction**, unless overridden by `CODEX_MODEL`, `CODEX_REASONING_EFFORT`, or `LLM_CREATIVITY`. The dropdown reads visible, image-capable models and supported reasoning levels from the local Codex model catalog; it does not hard-code an aging list of model names. Open Codex to refresh its catalog, then reload the studio. A custom model ID remains available when the catalog is missing or a new model has not appeared yet; account availability is confirmed by Codex when used.

**Reasoning effort** is sent as Codex's `model_reasoning_effort` setting. **Creative direction** (Restrained / Balanced / Bold) steers the script and visual-director instructions rather than pretending to be a Codex temperature knob. Research and QA remain evidence-driven at every creative setting. All model stages in a job use its saved model/effort. Per-job settings are isolated even with concurrent workers; successful cached stages retain their previous outputs on scoped regeneration.

Saved defaults live in `DATA_DIR/model-defaults.json`, separated by provider; job snapshots live in the job payload (JSON or PostgreSQL). Web and workers must share `DATA_DIR`, as they already do for video artifacts. **Restore environment defaults** clears the UI defaults for the configured provider. Credentials, provider, and API endpoint remain server configuration. The existing OpenAI-compatible API path accepts custom model IDs and creative direction; API reasoning-effort controls and OpenRouter-specific model discovery are not implemented yet.

`npm run test:settings-ui` exercises the studio in Chromium against isolated HTTP fixtures while the web app is running on port 3000 (`STUDIO_TEST_URL` can override it). It checks defaults, reload, submission overrides, regeneration, supported efforts, custom IDs, reset, and mobile layout without creating real videos or changing workspace settings.

## What is implemented

- Next.js review studio with persisted projects, worker progress, playable preview, source evidence, timestamped script, inspectable **Shots** tab, QA report, approval/download, skipping, and scoped regeneration.
- Node/TypeScript pipeline: research → exploration → script → Kokoro → shot plan → clean recording → edit → QA → final review.
- Separate browser passes. Exploration saves screenshots and replay instructions; only the fresh recording pass becomes browser footage.
- Typed visual inventory treats each README screenshot, GIF, video, section, code block and demo target as an independent candidate. Original raster/media downloads are bounded and every redirect is checked; inaccessible/unsupported media use an element capture. Badges and small icons are filtered out.
- The Visual Director maps narration and word timestamps to short visual slots, ranks source-matched assets, and optionally uses the configured Codex/API model with up to eight attached product previews to choose actual focal regions. Each persisted shot explains its purpose, asset, framing, motion, caption placement and selection rationale. Invalid model selections fall back to executable source-ranked shots.
- Product imagery can open the video before repository context. Context, product and detail framing preserve the dark blue identity. Individual images support crops, pushes, pulls, pans and source-anchored highlights. Code scenes show readable source excerpts; diagrams reveal source-backed nodes and connections in sequence and require cited relationships and narrated labels. Camera motion is baked into independent clips, so FFmpeg and HyperFrames use the same treatments.
- Visible scrolling is opt-in, at most three seconds per shot, never consecutive, and limited to 20% of runtime. Normal navigation happens before the recording trim. Shots normally stay under 4.5 seconds; plan validation rejects long identical compositions, gaps, missing/foreign assets and caption/focus collisions, and reports repeated sources, motions, weak visual support and low-resolution imagery.
- **Regenerate → Visuals** rebuilds direction, capture and editing while preserving research, script and narration. Existing inventory is upgraded automatically without changing scene IDs or regenerating voice.
- Public-page research, including GitHub's rendered README and relevant documentation links. Every factual segment cites an exact excerpt and a discovered visual from the same source.
- Optional local Codex provider using your ChatGPT login, or an OpenAI-compatible API provider, for research, safe exploratory interactions, script writing, and an independent factual audit. Website text is treated as untrusted evidence.
- **Without a model**, the app works in conservative source-excerpt mode. This avoids inventing capabilities, but produces a less polished script. No fake model responses or placeholder videos are used.
- Kokoro uses `/api/jobs` with storyboard segments, polls a saved speech job ID, downloads the real WAV, and uses returned timestamps as the master timeline. There is no silent or synthetic fallback for a missing speech service.
- Independent deterministic Playwright/demo clips and camera-treated media clips are saved after each shot. Checkpoints match the complete shot signature. Replays try stored/semantic/text locators; failures retry only the shot, then use a discovered screenshot and record the fallback reason. A missing clip preserves all surviving captures.
- FFmpeg assembles 1080 × 1920 / 30fps H.264 with AAC at 48 kHz. Captions overlay the composition at bottom-center, top-center, bottom-left or bottom-right and split at shot boundaries. Word timing is used where available; sentence-timed proportional chunks remain the fallback. Narration is never retimed to fit footage.
- Every job also gets a portable **HyperFrames HTML composition** with local GSAP, copied media, captions, narration, and seekable timing. Set `VIDEO_RENDERER=hyperframes` to check and render that composition instead of the fast FFmpeg path.
- QA checks output existence, delivery streams, voice duration, resolution, black intervals, long silence, clip duration, long static sections, error-page titles, caption/focal geometry, evidence references, plan diversity, exact capture signatures and complete shot coverage. Clean capture rejects detected consent overlays. Model mode also checks factual entailment. Media failures get one automatic repair pass.
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

No `LLM_API_KEY` is needed for this mode. Requests use your included Codex allowance and its usage limits. `CODEX_MODEL` can select a model available to your account; leave it blank for Codex's default. `LLM_MODEL` applies only to the API provider. If Codex is not on the worker's PATH, set `CODEX_BIN` to the executable's absolute path. Studio settings and `npm run doctor` show login readiness.

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
script.json
tts-progress.json              # external Kokoro job ID for restart recovery
narration.wav
transcript.json
shot-plan.json                 # timed visual intent and selection rationale
director-report.json           # direction diagnostics and fallback notes
diversity.json                 # final pre-capture plan validation
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
