import db from "./db";

/**
 * Keys the user can edit through the UI or via .env.
 * UI takes precedence over .env (env is only the fallback when the DB row is empty).
 */
export const SETTING_KEYS = [
  // ── Required API keys ─────────────────────────────────────────────
  "GOOGLE_API_KEY",          // Gemini — scene splitting
  "LABS69_API_KEY",          // 69labs — Grok img2vid + images
  "HEYGEN_API_KEY",          // HeyGen — TTS / voiceover generation
  "HEYGEN_VOICE_ID",         // HeyGen voice_id (from VA's voice clone or stock voice)

  // ── Optional / backup providers ───────────────────────────────────
  "ELEVENLABS_API_KEY",      // direct ElevenLabs (without 69labs)
  "GROQ_API_KEY",            // Groq Whisper — word-level transcription for single-shot TTS mode
  "PEXELS_API_KEY",          // Pexels — stock b-roll source for the AI+stock mix (one key per line for multiple)
  "MINIMAX_API_KEY",         // MiniMax TTS (cheap high-quality alternative)
  "MINIMAX_GROUP_ID",        // MiniMax Group ID (required in URL query param)
  "MINIMAX_VOICE_ID",        // MiniMax voice_id (cloned voice or stock voice)
  "MINIMAX_MODEL",           // MiniMax model — speech-02-hd / speech-02-turbo
  "REPLICATE_API_TOKEN",     // Replicate (Flux / Kling)
  "ANTHROPIC_API_KEY",       // Claude (alternative to Gemini)
  "OPENAI_API_KEY",          // OpenAI TTS / image backup
  "FAL_API_KEY",             // fal.ai (alternative to Replicate)
  "FFMPEG_PATH",             // absolute path to ffmpeg.exe if not in system PATH

  // ── Storage ───────────────────────────────────────────────────────
  "RUNS_OUTPUT_DIR",         // where run folders are written. Empty = default

  // ── Scene splitting (LLM) ─────────────────────────────────────────
  "SCENE_SPLIT_PROVIDER",    // google | anthropic
  "SCENE_SPLIT_MODEL",       // e.g. gemini-flash-latest, claude-sonnet-4-6

  // ── Text-to-Speech ────────────────────────────────────────────────
  "TTS_PROVIDER",            // heygen (default) | 69labs | elevenlabs | openai | minimax
  "TTS_MODE",                // per-scene (default) | single-shot. Single-shot synthesizes ONE audio for the whole script then aligns scene boundaries via Groq Whisper word-timestamps — fixes per-scene choppy boundaries.
  "TTS_VOICE_PROVIDER",      // For 69labs: edgetts | elevenlabs | voice-clone
  "TTS_VOICE_ID",            // Voice id (ElevenLabs / Edge / clone UUID). For HeyGen use HEYGEN_VOICE_ID
  "TTS_MODEL",               // e.g. eleven_multilingual_v2
  "TTS_SPLIT_TYPE",          // smart | paragraphs | max_length

  // ── ElevenLabs voice fine-tuning ──────────────────────────────────
  "TTS_SPEED",               // 0.7–1.2 (lower = slower)
  "TTS_STABILITY",           // 0–1
  "TTS_SIMILARITY_BOOST",    // 0–1
  "TTS_STYLE",               // 0–1
  "TTS_USE_SPEAKER_BOOST",   // "1" / "0" / ""

  // ── Auto-pause (stops TTS from "swallowing" sentence ends) ────────
  "TTS_AUTO_PAUSE",          // "1" to enable
  "TTS_PAUSE_DURATION",      // seconds (0.1–30)
  "TTS_PAUSE_FREQUENCY",     // 1–100

  // ── Images ────────────────────────────────────────────────────────
  "IMAGE_PROVIDER",          // 69labs | replicate | openai | fal
  "IMAGE_MODEL",             // e.g. nano-banana-pro, imagen-4, seedream-4.5
  "IMAGE_RATIO",             // e.g. 16:9, 9:16, 1:1
  "IMAGE_RESOLUTION",        // 1k | 2k | 4k (for models that support it)

  // ── Animations (img2vid) ──────────────────────────────────────────
  "ANIMATION_PROVIDER",      // off | 69labs | replicate | fal
  "ANIMATION_MODEL",         // e.g. veo-video, grok-imagine-video
  "ANIMATION_RATIO_PERCENT", // 0–100, percentage of scenes to animate
  "ANIMATION_DISTRIBUTION",  // first-half | alternating | random | all
  "ANIMATION_DURATION",      // seconds (provider-dependent)
  "ANIMATION_KEEP_VEO_AUDIO", // "1" to keep Veo's generated ambient audio

  // ── Video assembly (FFmpeg) ───────────────────────────────────────
  "VIDEO_RESOLUTION",        // e.g. 1920x1080
  "VIDEO_FPS",               // 24 / 30 / 60
  "SCENE_DURATION_SECONDS",  // fallback duration when TTS length is unknown
  "TRANSITION_DURATION",     // crossfade between scenes in seconds (0 = none)
  "SCENE_TAIL_SILENCE",      // silence appended to each clip's audio (seconds), creates breathing room between scenes

  // ── Performance / Concurrency ─────────────────────────────────────
  "IMAGE_CONCURRENCY",       // parallel image jobs
  "TTS_CONCURRENCY",         // parallel TTS jobs
  "ANIMATION_CONCURRENCY",   // parallel img2vid jobs
  "ASSEMBLE_CONCURRENCY",    // parallel FFmpeg clip renders
  "ASSEMBLE_XFADE_CHUNKS",   // split final xfade into N parallel chunks (1 = monolithic)

  // ── Visual source mix (AI generation + Pexels stock) ──────────────
  "STOCK_RATIO_PERCENT",       // 0–100. % of scenes that use a real Pexels stock clip instead of AI generation. 0 = full AI (default).
  "STOCK_FOOTAGE_ORIENTATION", // landscape | portrait | square
  "STOCK_FOOTAGE_MAX_HEIGHT",  // 720 | 1080 | 2160 — caps the stock file size
  "STOCK_FOOTAGE_MIN_DURATION",// seconds — skip stock stingers shorter than this

  // ── Avatar documentary mode ───────────────────────────────────────
  "VOICEOVER_PROVIDER",        // elevenlabs (direct, word-timestamps) | 69labs | heygen | minimax
  "ELEVENLABS_VOICE_ID",       // ElevenLabs narration voice_id (the script voiceover)
  "ELEVENLABS_MODEL",          // eleven_multilingual_v2 (default) | eleven_flash_v2_5
  "SECONDS_PER_VISUAL",        // seconds each image/clip stays on screen (default 4.5)
  "AVATAR_FREQUENCY_PERCENT",  // 0–100, % of beats where the avatar appears (default 15)
  "REAL_RATIO_PERCENT",        // 0–100, % of b-roll from real footage vs AI (default 80). Used for "mix" mode.
  "VISUAL_MODE",               // ai | real | mix — default visual source for new videos (default mix)
  "FOOTAGE_SOURCES",           // CSV priority list: pexels,pixabay,openverse,wikimedia
  "REAL_MATCH_THRESHOLD",      // 0–100. >0 = Gemini scores how well each stock hit matches the query; hits below the bar are skipped (falls back to AI). 0 = off.
  "PIXABAY_API_KEY",           // Pixabay (images + videos). Free, no attribution.
  "OPENVERSE_TOKEN",           // Optional Openverse bearer token for higher rate limits
  "AVATAR_BACKGROUND",         // HeyGen avatar background color (hex) + placeholder color
  "VISUAL_CONCURRENCY",        // parallel b-roll fetch/gen jobs (default 3)
  "AVATAR_CONCURRENCY",        // parallel HeyGen avatar-clip jobs (default 2)
  "YT_DLP_ENABLED",            // "1" to allow the yt-dlp YouTube source (OFF by default — copyright risk)
  "YT_DLP_PATH",               // path to yt-dlp(.exe) if not on PATH

  // ── AI provider (kie.ai nano-banana/Veo, or 69labs Grok) ──────────
  "AI_PROVIDER",               // kie | 69labs — engine for AI b-roll + avatar-from-text image
  "KIE_API_KEY",               // kie.ai API key (nano-banana images, Veo video)
  "KIE_IMAGE_MODEL",           // kie.ai image model id (nano-banana)
  "KIE_VIDEO_MODEL",           // kie.ai video model id (Veo)
  "KIE_AI_MEDIA",              // image (nano-banana + Ken Burns, cheap) | video (Veo, realistic)
  "AI_IMAGE_STYLE",            // default style suffix for AI image/video prompts (channel can override)

  // ── Reliability / scaling ─────────────────────────────────────────
  "FAILURE_THRESHOLD_PERCENT", // 0–100. If more than this % of scenes fail, the run aborts. Default 25.
  "AUTO_REUSE_ENABLED",      // "1" = pipeline auto-searches the library and reuses matches without a preview step
  "AUTO_REUSE_THRESHOLD",    // 0–100 confidence %. Scenes matching at/above this are auto-reused. Default 80.
  "MAX_FRESH_CLIPS_PER_RUN", // Hard cap. If more than N scenes remain fresh after normal auto-reuse, force additional library reuse at the lowest threshold until under cap. 0 = disabled.
  "SCENE_DEDUPE_ENABLED",    // "1" = post-process scene-split: detect adjacent near-duplicate visual_prompts and re-ask Gemini to vary them. Default "1".
  "SCENE_DEDUPE_THRESHOLD",  // 0–1 Jaccard similarity threshold for dedupe. Default 0.7.
  "SCENE_DEDUPE_MAX_PASSES", // 1–5. How many times to re-run the dedupe pass until no duplicate groups remain. Default 3.
  "ASSEMBLE_XFADE_MAX_SCENES", // Max scene count before assembly falls back to simple concat (no xfade). Prevents OOM on huge runs. Default 150.

  // ── Google Drive sync ─────────────────────────────────────────────
  // OAuth2 credentials from Google Cloud Console (Web Application client).
  // Redirect URI must be set to http://localhost:3000/api/gdrive/oauth/callback
  "GDRIVE_CLIENT_ID",
  "GDRIVE_CLIENT_SECRET",
  // Refresh token, set automatically after the user completes the OAuth flow.
  // Don't edit by hand.
  "GDRIVE_REFRESH_TOKEN",
  // Email of the Google account that authorized — set automatically, shown in UI.
  "GDRIVE_CONNECTED_EMAIL",
  // Folder IDs in Drive. Empty = auto-create `Conveyer Grok/Final Videos` and
  // `Conveyer Grok/Clips Library` in the user's Drive root on first sync.
  "GDRIVE_FINAL_VIDEOS_FOLDER_ID",
  "GDRIVE_CLIPS_LIBRARY_FOLDER_ID",
  // Master switch. Empty/"0" = disabled (don't upload). "1" = upload after every run.
  "GDRIVE_SYNC_ENABLED",
] as const;

/** Keys whose values are secrets and should be masked when sent to the UI. */
function isSecretKey(key: string): boolean {
  return key.includes("KEY") || key.includes("TOKEN") || key.includes("SECRET");
}

export type SettingKey = (typeof SETTING_KEYS)[number];

const getStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertStmt = db.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
);

export function getSetting(key: SettingKey): string {
  const row = getStmt.get(key) as { value: string } | undefined;
  if (row && row.value !== "") return row.value;
  return process.env[key] ?? "";
}

export function setSetting(key: SettingKey, value: string) {
  upsertStmt.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  return out;
}

/** Safe version — masks secret keys/tokens/secrets. Handles multi-line key lists too. */
export function getMaskedSettings(): Record<string, string> {
  const all = getAllSettings();
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (isSecretKey(k)) {
      if (!v) {
        masked[k] = "";
      } else {
        // Mask each line/entry separately so multi-key fields show all entries
        const parts = v.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
        masked[k] = parts.map((p) => `${p.slice(0, 4)}…${p.slice(-4)}`).join("\n");
      }
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export const DEFAULTS: Record<SettingKey, string> = {
  // Required API keys — empty by default, user must provide
  GOOGLE_API_KEY: "",
  LABS69_API_KEY: "",
  HEYGEN_API_KEY: "",
  HEYGEN_VOICE_ID: "",

  // Optional providers
  ELEVENLABS_API_KEY: "",
  GROQ_API_KEY: "",
  PEXELS_API_KEY: "",
  MINIMAX_API_KEY: "",
  MINIMAX_GROUP_ID: "",
  MINIMAX_VOICE_ID: "",
  MINIMAX_MODEL: "speech-02-hd",
  REPLICATE_API_TOKEN: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  FAL_API_KEY: "",
  FFMPEG_PATH: "",

  // Storage — empty = use default (DATA_DIR/runs)
  RUNS_OUTPUT_DIR: "",

  // Scene split
  SCENE_SPLIT_PROVIDER: "google",
  SCENE_SPLIT_MODEL: "gemini-flash-latest",

  // TTS — Conveyer Grok defaults to HeyGen (Miguel's VA voices live there).
  // Switch to 69labs/elevenlabs/openai via /settings if needed.
  TTS_PROVIDER: "heygen",
  TTS_MODE: "per-scene",
  TTS_VOICE_PROVIDER: "edgetts",
  TTS_VOICE_ID: "en-US-GuyNeural",
  TTS_MODEL: "",
  TTS_SPLIT_TYPE: "smart",

  // Voice fine-tuning (slightly slower + small style for documentary feel)
  TTS_SPEED: "0.93",
  TTS_STABILITY: "0.6",
  TTS_SIMILARITY_BOOST: "0.75",
  TTS_STYLE: "0.15",
  TTS_USE_SPEAKER_BOOST: "1",

  // Auto-pause on sentence boundaries
  TTS_AUTO_PAUSE: "1",
  TTS_PAUSE_DURATION: "0.4",
  TTS_PAUSE_FREQUENCY: "1",

  // Images — Conveyer Grok is video-only. These defaults are kept only so
  // that legacy DB rows don't crash anything; the pipeline never reads them.
  IMAGE_PROVIDER: "off",
  IMAGE_MODEL: "nano-banana-pro",
  IMAGE_RATIO: "16:9",
  IMAGE_RESOLUTION: "1k",

  // Animations — Conveyer Grok animates EVERY scene through Grok via 69labs.
  ANIMATION_PROVIDER: "69labs",
  ANIMATION_MODEL: "grok-imagine-video",  // xAI Grok video via 69labs (text-to-video)
  ANIMATION_RATIO_PERCENT: "100",         // 100 % of scenes animated, no Ken-Burns mix
  ANIMATION_DISTRIBUTION: "all",
  ANIMATION_DURATION: "",                 // ignored by Grok (69labs hard-codes ~6s); applies only to non-Grok/non-Veo models
  ANIMATION_KEEP_VEO_AUDIO: "",           // legacy name — applies to any model with embedded audio

  // Video assembly
  VIDEO_RESOLUTION: "1920x1080",
  VIDEO_FPS: "30",
  SCENE_DURATION_SECONDS: "5",
  TRANSITION_DURATION: "0.5",
  SCENE_TAIL_SILENCE: "0.4",

  // Performance
  IMAGE_CONCURRENCY: "5",
  TTS_CONCURRENCY: "3",
  ANIMATION_CONCURRENCY: "3",
  ASSEMBLE_CONCURRENCY: "4",
  ASSEMBLE_XFADE_CHUNKS: "4",

  // Visual source mix (AI + Pexels stock)
  STOCK_RATIO_PERCENT: "0",
  STOCK_FOOTAGE_ORIENTATION: "landscape",
  STOCK_FOOTAGE_MAX_HEIGHT: "1080",
  STOCK_FOOTAGE_MIN_DURATION: "4",

  // Avatar documentary mode
  VOICEOVER_PROVIDER: "elevenlabs",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_MODEL: "eleven_multilingual_v2",
  SECONDS_PER_VISUAL: "4.5",
  AVATAR_FREQUENCY_PERCENT: "15",
  REAL_RATIO_PERCENT: "80",
  VISUAL_MODE: "mix",
  FOOTAGE_SOURCES: "pexels,pixabay,openverse,wikimedia",
  REAL_MATCH_THRESHOLD: "0",
  PIXABAY_API_KEY: "",
  OPENVERSE_TOKEN: "",
  AVATAR_BACKGROUND: "",
  VISUAL_CONCURRENCY: "3",
  AVATAR_CONCURRENCY: "2",
  YT_DLP_ENABLED: "",
  YT_DLP_PATH: "",

  // AI provider
  AI_PROVIDER: "kie",
  KIE_API_KEY: "",
  KIE_IMAGE_MODEL: "google/nano-banana",
  KIE_VIDEO_MODEL: "veo3_fast",
  KIE_AI_MEDIA: "image",
  AI_IMAGE_STYLE: "cinematic, photo realistic, natural lighting, documentary",

  // Reliability / scaling
  FAILURE_THRESHOLD_PERCENT: "25",
  AUTO_REUSE_ENABLED: "1",
  AUTO_REUSE_THRESHOLD: "80",
  MAX_FRESH_CLIPS_PER_RUN: "0",
  SCENE_DEDUPE_ENABLED: "1",
  SCENE_DEDUPE_THRESHOLD: "0.7",
  SCENE_DEDUPE_MAX_PASSES: "3",
  ASSEMBLE_XFADE_MAX_SCENES: "150",

  // Google Drive — all empty by default. User fills client_id/secret;
  // OAuth flow fills refresh_token + email; folders auto-create on first sync.
  GDRIVE_CLIENT_ID: "",
  GDRIVE_CLIENT_SECRET: "",
  GDRIVE_REFRESH_TOKEN: "",
  GDRIVE_CONNECTED_EMAIL: "",
  GDRIVE_FINAL_VIDEOS_FOLDER_ID: "",
  GDRIVE_CLIPS_LIBRARY_FOLDER_ID: "",
  GDRIVE_SYNC_ENABLED: "",
};

/** Write defaults for any keys that aren't already in the DB. */
export function seedDefaults() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    const row = getStmt.get(k) as { value: string } | undefined;
    if (!row) upsertStmt.run(k, v);
  }
  forceVideoOnlyMode();
  clearStaleAvatarBackground();
}

/**
 * One-time migration: early builds seeded AVATAR_BACKGROUND="#101418", which
 * forced HeyGen to render the avatar on a near-black canvas (the pillarbox
 * bars). Updating the app doesn't touch existing DB rows, so clear that exact
 * legacy value once; anything user-chosen is left alone.
 */
function clearStaleAvatarBackground() {
  const flag = getStmt.get("_migration_avatar_bg_clear") as { value: string } | undefined;
  if (flag?.value === "1") return;
  const row = getStmt.get("AVATAR_BACKGROUND") as { value: string } | undefined;
  if (row && row.value.trim().toLowerCase() === "#101418") {
    upsertStmt.run("AVATAR_BACKGROUND", "");
  }
  upsertStmt.run("_migration_avatar_bg_clear", "1");
}

/**
 * One-time correction for users coming from the Hum Conveyer template (Veo →
 * Grok migration). Conveyer Grok runs Grok via 69labs for every scene, so we
 * flip any inherited `veo-*` model IDs to `grok-imagine-video` on first boot.
 * Tracked via a flag so we never overwrite a user's later manual choice.
 */
function forceVideoOnlyMode() {
  const flag = getStmt.get("_migration_grok_video_only") as { value: string } | undefined;
  if (flag?.value === "1") return;

  const rules: Array<[string, (current: string) => string | null]> = [
    ["ANIMATION_PROVIDER", (v) => (v === "off" ? "69labs" : null)],
    ["ANIMATION_RATIO_PERCENT", (v) => (v !== "100" ? "100" : null)],
    ["ANIMATION_DISTRIBUTION", (v) => (v !== "all" ? "all" : null)],
    ["IMAGE_PROVIDER", (v) => (v && v !== "off" ? "off" : null)],
    // Migrate inherited Veo model IDs from Hum Conveyer template
    ["ANIMATION_MODEL", (v) => (/^veo/i.test(v) ? "grok-imagine-video" : null)],
  ];
  for (const [key, transform] of rules) {
    const row = getStmt.get(key) as { value: string } | undefined;
    if (!row) continue;
    const next = transform(row.value);
    if (next !== null && next !== row.value) {
      upsertStmt.run(key, next);
    }
  }
  upsertStmt.run("_migration_grok_video_only", "1");
}
