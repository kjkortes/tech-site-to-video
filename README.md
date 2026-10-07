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

## What is implemented

- Next.js review studio with persisted projects, worker progress, playable preview, source evidence, timestamped script, QA report, approval/download, skipping, and scoped regeneration.
- Node/TypeScript pipeline: research → exploration → script → Kokoro → shot plan → clean recording → edit → QA → final review.
- Separate browser passes. Exploration saves screenshots and replay instructions; only the fresh recording pass becomes browser footage.
- Vertical videos browse with a phone-width viewport, mobile user agent, and touch emulation so sites use their responsive mobile layout. Regenerating visuals refreshes older desktop captures while preserving the script and narration.
- Public-page research, including GitHub's rendered README and relevant documentation links. Every factual segment cites an exact excerpt and a discovered visual from the same source.
- Optional OpenAI-compatible model for research, safe exploratory interactions, script writing, and an independent factual audit. Set `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`. Website text is treated as untrusted evidence.
- **Without a model**, the app works in conservative source-excerpt mode. This avoids inventing capabilities, but produces a less polished script. No fake model responses or placeholder videos are used.
- Kokoro uses `/api/jobs` with storyboard segments, polls a saved speech job ID, downloads the real WAV, and uses returned timestamps as the master timeline. There is no silent or synthetic fallback for a missing speech service.
- Independent Playwright clips with handles, saved after each shot. Replays try stored/semantic/text locators; failures retry the shot, then use its discovered screenshot as a supporting visual.
- FFmpeg assembles 1080 × 1920 H.264/AAC MP4 with framed browser footage, title, and burned captions. Captions use word timestamps where available; sentence-timed proportional chunks are a documented fallback.
- Every job also gets a portable **HyperFrames HTML composition** with local GSAP, copied media, captions, narration, and seekable timing. Set `VIDEO_RENDERER=hyperframes` to check and render that composition instead of the fast FFmpeg path.
- QA checks output existence, streams, voice duration, resolution, black intervals, long silence, clip duration, static sections, error-page titles, caption constraints, evidence references, and complete shot coverage. Model mode also checks factual entailment. Media failures get one automatic repair pass.
- Local JSON snapshots are atomically replaced. Per-job leases prevent a worker and review action from writing simultaneously. Worker restarts reuse stage artifacts and completed clips. Provider/stage failures get one automatic retry and then an actionable saved failure.
- Optional PostgreSQL job persistence and BullMQ/Redis dispatch. Local disk remains the artifact store in both modes.

## Persistence and regeneration

Artifacts live under `data/jobs/<job-id>/`:

```text
job.json                       # local job state (PostgreSQL mode stores state in DB)
research.json                  # URLs, evidence text, claims and citations
inventory.json                 # scenes, screenshots and replay actions
exploration/scene-*.png
script.json
tts-progress.json              # external Kokoro job ID for restart recovery
narration.wav
transcript.json
shot-plan.json
clips/001.webm ...              # independent clean recordings
recordings.json                # successful clips + trim points + fallback flags
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
| Visuals | Recording | Research through shot plan, including narration |

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

Exploration is bounded to a handful of public pages and headings, with optional model-selected read-only interactions. It does not yet implement HyperAgent/Hermes, arbitrary application input, CAPTCHA solving, authentication, vision-based locator recovery, or deployment of GitHub repositories. Remote non-GET requests and form submissions are blocked to keep exploration read-only; some interactive demos therefore fall back to documentation or screenshots. An inaccessible site fails clearly instead of generating a misleading demo.

Pixel-level semantic vision QA is not implemented. The quality report explicitly marks frame meaning for human review. Error detection currently uses HTTP responses and page titles, freeze detection flags static sections as review warnings, and caption validation checks timing/length constraints rather than every rasterized pixel. A QA percentage is the share of checks passed, not a claim that a vision model graded the video. The final human review remains necessary.

AI quality and GitHub/site variability require broader real-world evaluation. The default renderer and local pipeline are covered end to end, and a short HyperFrames composition has been checked and rendered. Model, Redis, and PostgreSQL adapters require their configured services. S3 storage and automatic publishing are future work.

The app binds to loopback and is intended for a trusted local workspace. It has no multi-user authentication. Do not turn this into a public service without authentication, quotas, sandboxed browser egress, and stronger storage isolation. URL validation rejects private/loopback/link-local addresses and checks browser requests and redirects, but DNS validation alone is not a hardened defense against DNS rebinding.

## Implementation references

[Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Playwright video lifecycle](https://playwright.dev/docs/api/class-video), [BullMQ worker locks](https://docs.bullmq.io/guide/workers/stalled-jobs), and [HyperFrames CLI](https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md).
