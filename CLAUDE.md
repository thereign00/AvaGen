# CLAUDE.md — project context for Claude Code

Auto-loaded by Claude Code. Full picture of **Faceless Video Generator**.

---

## What Faceless Video Generator is

A **local web app** that turns a written script into a finished, avatar-fronted
**documentary YouTube video**. The operator pastes a script and picks a recurring
**avatar** (an ultra-realistic presenter created once from a reference photo).
**ElevenLabs** narrates the whole script; **HeyGen** brings the avatar to life,
lip-synced to that narration; the rest of the screen time is filled with **real
internet footage** (Pexels / Pixabay / Openverse / Wikimedia, optionally YouTube)
or **AI b-roll** (Grok via 69labs) — operator's choice (AI / real / mix). Still
images get a **Ken Burns** zoom. Runs entirely on the user's machine
(Next.js dev server + local SQLite + local FFmpeg).

**Target user**: non-technical YouTube creators. UX must stay simple.
**Built from**: Conveyer Grok – Bullnet 2.0 (faceless AI-video pipeline). It
adds the avatar library, the script→ElevenLabs→HeyGen flow, the broader
real-footage search, and Ken Burns on stills.

**Read `docs/DESIGN.md`** — it has the full design + the confirmed HeyGen,
ElevenLabs, footage-source and Ken Burns API details.

---

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** · **Tailwind 4**
- **better-sqlite3** — local DB at `~/.faceless-studio/studio.db` (override `FACELESS_STUDIO_DATA_DIR`)
- **fluent-ffmpeg** / system FFmpeg — voiceover concat, Ken Burns, beat compositing
- Node ≥ 20. Dev server: `npm run dev` on port 3000.

---

## The studio pipeline (the new core)

`POST /api/studio` (script + avatarId + visualMode + timing) → inserts a `runs`
row, snapshots the chosen avatar + channel onto it, fires `runStudioPipeline()`
in the background → UI streams logs at `/runs/[id]`.

`src/lib/studio-pipeline.ts` `runStudioPipeline(runId, script)`:
1. **Voiceover** — `services/elevenlabs-voiceover.ts` synthesizes the whole script
   via ElevenLabs `/with-timestamps`, returns `voiceover.mp3` + per-word timings
   (no Whisper pass). Long scripts are chunked + timings offset to one timeline.
2. **Beats** — `services/studio-plan.ts` folds words into ~`SECONDS_PER_VISUAL`
   beats (sentence-aware), picks ~`AVATAR_FREQUENCY_PERCENT` avatar beats
   (beat 0 = full "avatar", others = "split"), asks Gemini for a concrete visual
   query per b-roll beat, and assigns real-vs-AI source by ratio.
3. **Per beat** (concurrency-limited):
   - b-roll (broll/split) → `services/visual-source.ts`: real footage from
     Pexels/Pixabay/Openverse/Wikimedia (+ opt-in YouTube via yt-dlp), else AI
     via `img2vid.ts`. Stills → `services/ken-burns.ts` zoom clip.
   - avatar (avatar/split) → slice that beat's audio, `services/heygen-video.ts`
     generates a HeyGen talking-head clip for just that slice (cheap — only ~15%
     of beats), driven by our ElevenLabs audio.
4. **Composite** — `services/studio-assemble.ts` renders each beat silent to its
   exact length, concatenates (hard cuts), and muxes the one master voiceover.

The faceless base pipeline (`pipeline.ts`, scene-split) and the old "upload a
finished avatar MP4" flow (`avatar-pipeline.ts`, `/avatar`) still exist but are
not in the nav.

---

## Avatar library (the core feature)

- DB table `avatars` (see `db.ts`) + CRUD in `src/lib/avatars.ts`.
- Create: `/avatars` page → `POST /api/avatars` (multipart: name, description,
  engine, image). Saves a local copy of the reference image under
  `<DATA_DIR>/avatars/<id>.<ext>`, then `services/heygen-avatar.ts` `ingestAvatar()`
  registers it with HeyGen in the background; the UI polls status.
- Engines: **talking_photo** (default, no training — upload → `talking_photo_id`)
  or **photo_avatar_group** (trained, slower). Optional **Avatar IV** engine flag
  for higher realism. `status`: pending → training → ready → error.
- A run snapshots the resolved avatar onto `runs.avatar_*` columns at create time.

---

## Key external services

| Service | Used for | Setting |
|---|---|---|
| **ElevenLabs** | narration voiceover (+ word timings) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` |
| **HeyGen** | create avatar + render talking-head clips | `HEYGEN_API_KEY` |
| **Gemini** | per-beat visual search query | `GOOGLE_API_KEY` (optional) |
| **Pexels / Pixabay / Openverse / Wikimedia** | real footage + stills | `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `OPENVERSE_TOKEN`, `FOOTAGE_SOURCES` |
| **yt-dlp (YouTube)** | OPT-IN real footage (copyright risk) | `YT_DLP_ENABLED`, `YT_DLP_PATH` |
| **69labs (Grok)** | AI b-roll | `LABS69_API_KEY` |

HeyGen v1/v2 API (supported through 2026-10-31): `X-Api-Key` header; upload asset
(raw binary) → `image_key`/audio `id`; `/v2/video/generate` with `voice.type:"audio"`
+ `audio_asset_id`; poll `/v1/video_status.get`. Details in `docs/DESIGN.md`.

---

## Conventions & gotchas (inherited base — still true)

- DB lives **outside** the project tree so `git pull` never touches user data.
  Schema changes use `tryAddColumn()` in `db.ts` (no `ADD COLUMN IF NOT EXISTS`).
- Settings form is schema-driven — add a field in `app/settings/_groups.ts`, and
  add the key to `SETTING_KEYS` + `DEFAULTS` in `settings.ts`. These keys are
  surfaced on the main `/settings` page (see `MAIN_TITLES`).
- Secrets are masked with `…` to the UI; the save handler skips values still
  containing `…` so it never overwrites a real key with the mask.
- Project path can contain spaces — always `path.join`; ffmpeg concat lists
  single-quote-escape paths.
- UI uses the `globals.css` design tokens / `.btn` / `.card` / `.input` classes.

## Verify a change

1. `npx tsc --noEmit` — 0 errors.
2. `npx next build` — compiles + prerenders all pages.
3. `npm run dev`, exercise the changed page. A real end-to-end render needs
   HeyGen + ElevenLabs keys (you provide them).

## Known follow-ups

- Channels (`channels` table) carry a default avatar (`channels.avatar_id`); the
  Chaînes UI doesn't yet expose picking it (set via API). A stale/deleted channel
  default degrades to a faceless run (it won't block the channel).
- YouTube/yt-dlp source is wired but OFF by default (legal); needs the `yt-dlp`
  binary installed.
- Avatar beats each call HeyGen separately — could be batched to cut render time.
- Veo can't render 1:1, so a square channel + `KIE_AI_MEDIA=video` coerces to 16:9
  (nano-banana images and real footage honor square). Minor.
- Per-channel `format` (resolution) IS threaded end-to-end (voiceover→beats→
  Ken Burns→HeyGen dimension→assemble) as of the post-review pass.

## Verified (2026-06-08)

tsc 0 errors · `next build` exit 0 · server boots · all pages + new endpoints
serve 200 · DB migrations apply. A 3-dimension adversarial review (kie/contract/UI)
found 9 issues — all fixed (non-array fetch guards, kie.ai body-`code` error
surfacing, channel-default-avatar graceful degrade, format threading, empty-number
input guard, broken-thumbnail fallback, settings-load guard, dead-branch cleanup).
NOT yet run end-to-end against live HeyGen/ElevenLabs/kie keys.
