import fs from "node:fs";
import { getSetting } from "../settings";
import { log } from "../logger";
import { checkCancelled } from "../cancellation";
import type { Scene } from "./scene-split";

/**
 * Pexels stock footage service — search + download.
 *
 * Ported from Conveyer Guilherme (the stock-only fork). In Conveyer Grok this
 * is the "stock" visual source: scenes routed to stock (by STOCK_RATIO_PERCENT)
 * pull a real Pexels clip instead of generating one via Grok / gemini-omni.
 *
 * Free tier: 200 req/hour, 20 000/month. The API key is required.
 * Sign-up: https://www.pexels.com/api/  (free, ~30 seconds)
 * Docs:    https://www.pexels.com/api/documentation/
 *
 * Attribution: Pexels licenses everything for commercial use without
 * attribution, but their TOS recommend a credit "Video by <author> from
 * Pexels". We log the author name on every download so it can land in the
 * final video's description block later.
 */

const PEXELS_BASE = "https://api.pexels.com";

// ── Types (mirroring Pexels API JSON) ────────────────────────────────────────

export interface PexelsVideoFile {
  id: number;
  quality: string;       // "hd" | "sd" | "uhd"
  file_type: string;     // "video/mp4"
  width: number;
  height: number;
  link: string;          // direct download URL
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;      // seconds
  url: string;           // pexels.com page URL (not a file)
  image: string;         // thumbnail URL
  video_files: PexelsVideoFile[];
  user?: { name?: string; url?: string };
}

interface PexelsVideoSearchResponse {
  total_results: number;
  page: number;
  per_page: number;
  videos: PexelsVideo[];
  next_page?: string;
}

export type Orientation = "landscape" | "portrait" | "square";

export interface StockSearchOptions {
  orientation?: Orientation;
  /** Pexels accepts "large" (4K+) / "medium" (1080p+) / "small" (HD). */
  size?: "large" | "medium" | "small";
  /** Filters out flashy short stingers (< minDuration seconds). */
  minDuration?: number;
  /** Max results per request (default 15, max 80). */
  perPage?: number;
}

// ── Multi-key pool with rate-limit awareness ────────────────────────────────
//
// Pexels free tier = 200 req/hour, 20 000/month (rolling).
// Successful responses include X-Ratelimit-Remaining + X-Ratelimit-Reset
// (UNIX seconds). On 429 those headers are NOT returned, so we fall back to
// the last resetAt we saw from a successful response.
//
// PEXELS_API_KEY can hold multiple keys (one per line, or comma/semicolon
// separated). The pool tries the current key until it's rate-limited, then
// rotates to the next. When all keys are exhausted at once, it waits on the
// one whose window refreshes earliest, then resumes there.

interface KeyState {
  key: string;
  remaining: number | null;
  resetAt: number | null;          // UNIX seconds (from X-Ratelimit-Reset)
  exhaustedUntilMs: number | null; // UNIX ms — when this key becomes usable again
}

const keyPool: { keys: KeyState[]; cursor: number } = {
  keys: [],
  cursor: 0,
};

/** Re-parse PEXELS_API_KEY each call; preserve state for keys we've seen before. */
function refreshKeyPool(): KeyState[] {
  const raw = getSetting("PEXELS_API_KEY") || "";
  const parsed = raw
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (parsed.length === 0) {
    throw new Error("PEXELS_API_KEY is not set — add it in /settings (one key per line for multiple)");
  }
  const existing = new Map(keyPool.keys.map((k) => [k.key, k]));
  keyPool.keys = parsed.map(
    (k) =>
      existing.get(k) ?? {
        key: k,
        remaining: null,
        resetAt: null,
        exhaustedUntilMs: null,
      }
  );
  if (keyPool.cursor >= keyPool.keys.length) keyPool.cursor = 0;
  return keyPool.keys;
}

function updateKeyFromHeaders(state: KeyState, headers: Headers): void {
  const rem = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (rem !== null) {
    const n = parseInt(rem, 10);
    if (Number.isFinite(n)) state.remaining = n;
  }
  if (reset !== null) {
    const n = parseInt(reset, 10);
    if (Number.isFinite(n)) state.resetAt = n;
  }
}

function markKeyExhausted(state: KeyState): void {
  // Use the last known reset, else default to one hour from now (Pexels window).
  if (state.resetAt !== null) {
    state.exhaustedUntilMs = state.resetAt * 1000 + 5000; // +5s safety
  } else {
    state.exhaustedUntilMs = Date.now() + 60 * 60 * 1000;
  }
}

/** Cancel-aware sleep — checks `checkCancelled(runId)` every 5 seconds. */
async function sleepWithCancel(ms: number, runId?: string): Promise<void> {
  const CHECK_INTERVAL_MS = 5000;
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (runId) checkCancelled(runId);
    const remaining = ms - (Date.now() - start);
    await new Promise<void>((r) => setTimeout(r, Math.min(CHECK_INTERVAL_MS, remaining)));
  }
}

function formatLocalTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Picks an available key. If none are available, sleeps until the
 * earliest-recovering key is ready, then returns it.
 */
async function acquireKey(runId?: string): Promise<KeyState> {
  while (true) {
    const keys = refreshKeyPool();
    const now = Date.now();

    // Scan starting at cursor for any key not currently exhausted.
    for (let i = 0; i < keys.length; i++) {
      const idx = (keyPool.cursor + i) % keys.length;
      const k = keys[idx];
      if (k.exhaustedUntilMs === null || k.exhaustedUntilMs <= now) {
        if (k.exhaustedUntilMs !== null && k.exhaustedUntilMs <= now) {
          k.exhaustedUntilMs = null;
          k.remaining = null;
          if (runId) {
            log(runId, "info", `Pexels key #${idx + 1} cooldown ended — using it`, { stage: "animate" });
          }
        }
        keyPool.cursor = idx;
        return k;
      }
    }

    // All keys exhausted. Find the one that recovers soonest.
    let earliestIdx = 0;
    let earliestUntil = keys[0].exhaustedUntilMs ?? Infinity;
    for (let i = 1; i < keys.length; i++) {
      const u = keys[i].exhaustedUntilMs ?? Infinity;
      if (u < earliestUntil) {
        earliestIdx = i;
        earliestUntil = u;
      }
    }
    const earliest = keys[earliestIdx];
    const waitMs = Math.max(0, (earliest.exhaustedUntilMs ?? now) - now) + 5000;
    const cappedWait = Math.min(waitMs, 75 * 60 * 1000);

    if (runId) {
      const untilLabel = earliest.resetAt !== null ? ` until ${formatLocalTime(earliest.resetAt)}` : "";
      const minutes = Math.max(1, Math.ceil(cappedWait / 60000));
      log(
        runId,
        "warn",
        `All ${keys.length} Pexels key${keys.length === 1 ? "" : "s"} rate-limited — pausing ~${minutes} min${untilLabel}, then auto-resume on key #${earliestIdx + 1}`,
        { stage: "animate" }
      );
    }

    keyPool.cursor = earliestIdx;
    await sleepWithCancel(cappedWait, runId);
  }
}

/**
 * Wraps fetch with multi-key rate-limit handling.
 * On 429 → mark current key exhausted → loop, picking the next available key.
 * If every key gets exhausted N times → bail (likely monthly quota hit).
 */
async function pexelsFetch(url: URL | string, runId: string | undefined): Promise<Response> {
  const keys = refreshKeyPool();
  const MAX_429_HITS = keys.length * 3;

  let hits429 = 0;
  while (hits429 < MAX_429_HITS) {
    const state = await acquireKey(runId);
    const resp = await fetch(url, { headers: { Authorization: state.key } });

    if (resp.status === 429) {
      hits429++;
      try {
        await resp.text();
      } catch {}
      const idx = keyPool.keys.indexOf(state);
      markKeyExhausted(state);
      if (runId) {
        const untilLabel =
          state.resetAt !== null ? ` (window resets ${formatLocalTime(state.resetAt)})` : "";
        log(
          runId,
          "warn",
          `Pexels key #${idx + 1} rate-limited${untilLabel} — rotating to next available key`,
          { stage: "animate" }
        );
      }
      keyPool.cursor = (idx + 1) % keyPool.keys.length;
      continue;
    }

    if (resp.ok) {
      updateKeyFromHeaders(state, resp.headers);
      if (state.remaining !== null && state.remaining < 3) {
        markKeyExhausted(state);
      }
    }
    return resp;
  }

  throw new Error(
    `All Pexels keys rate-limited for too long (${MAX_429_HITS} retries) — likely monthly quota exhausted on every key. ` +
      `Check https://www.pexels.com/api/`
  );
}

/** Raw search call. Returns up to options.perPage videos, newest first by relevance. */
export async function searchPexelsVideos(
  query: string,
  options: StockSearchOptions & { runId?: string } = {}
): Promise<PexelsVideo[]> {
  const url = new URL(`${PEXELS_BASE}/videos/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(options.perPage ?? 15));
  if (options.orientation) url.searchParams.set("orientation", options.orientation);
  if (options.size) url.searchParams.set("size", options.size);
  if (options.minDuration && options.minDuration > 0) {
    url.searchParams.set("min_duration", String(options.minDuration));
  }

  const resp = await pexelsFetch(url, options.runId);
  if (!resp.ok) {
    const txt = (await resp.text()).slice(0, 300);
    throw new Error(`Pexels search HTTP ${resp.status}: ${txt}`);
  }
  const data = (await resp.json()) as PexelsVideoSearchResponse;
  return Array.isArray(data.videos) ? data.videos : [];
}

/**
 * Pre-flight connectivity + key check. Does one tiny Pexels search.
 * The pipeline calls this BEFORE generating any voiceovers (when stock is in
 * play), so a misconfigured Pexels key fails in seconds instead of mid-run.
 */
export async function pexelsPreflight(runId: string): Promise<void> {
  await searchPexelsVideos("nature", { perPage: 1, runId });
}

/**
 * Picks the best MP4 file from one Pexels video:
 *  - MP4 only (Pexels also serves .mov sometimes)
 *  - Prefers the largest file whose height is <= maxHeight (no upscaling needed)
 *  - Falls back to smallest file above maxHeight if nothing fits
 */
export function pickBestVideoFile(
  video: PexelsVideo,
  options: { maxHeight?: number } = {}
): PexelsVideoFile | null {
  const maxH = options.maxHeight ?? 1080;
  const mp4s = video.video_files.filter((f) => /mp4/i.test(f.file_type));
  if (mp4s.length === 0) return null;

  const below = mp4s.filter((f) => f.height <= maxH).sort((a, b) => b.height - a.height);
  if (below.length > 0) return below[0];

  return [...mp4s].sort((a, b) => a.height - b.height)[0] ?? null;
}

/** Stream-download a video file to disk. Throws on non-200. */
export async function downloadPexelsVideo(
  videoFile: PexelsVideoFile,
  outPath: string
): Promise<void> {
  const resp = await fetch(videoFile.link);
  if (!resp.ok) {
    throw new Error(`Pexels download HTTP ${resp.status}: ${videoFile.link}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new Error(`Pexels returned empty file: ${videoFile.link}`);
  }
  fs.writeFileSync(outPath, buf);
}

// ── Scene-level wrapper used by the pipeline ─────────────────────────────────

/**
 * Builds a Pexels-friendly search query from a scene's visual_prompt.
 * The pipeline produces long, descriptive visual_prompts; Pexels works much
 * better with shorter natural-language queries, so we trim to ~18 words and
 * strip punctuation.
 */
export function visualPromptToQuery(visualPrompt: string, maxWords = 18): string {
  return visualPrompt
    .split(/\s+/)
    .slice(0, maxWords)
    .join(" ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AcquireOptions {
  runId: string;
  orientation?: Orientation;
  maxHeight?: number;
  minDuration?: number;
  /**
   * MUTABLE set of Pexels video ids already claimed/downloaded in this run.
   * Read to skip duplicates AND the picked id is added before download.
   * Atomic because JS is single-threaded — no two concurrent scenes can grab
   * the same clip. Pass a fresh `new Set<number>()` per pipeline run.
   */
  usedIds?: Set<number>;
}

/**
 * High-level helper: search Pexels for a scene's visual_prompt, download the
 * best non-duplicate candidate to outPath. Returns the picked video metadata.
 * Throws if no candidates download successfully.
 */
export async function acquireStockClipForScene(
  scene: Scene,
  outPath: string,
  options: AcquireOptions
): Promise<{ pexelsId: number; author: string | null; sourceUrl: string }> {
  const { runId, orientation = "landscape", maxHeight = 1080, minDuration = 4, usedIds } = options;

  const query = visualPromptToQuery(scene.visual_prompt);
  if (!query) {
    throw new Error(`Scene #${scene.index}: visual_prompt produced an empty Pexels query`);
  }

  log(runId, "debug", `Pexels search: "${query}"`, { stage: "animate" });

  const videos = await searchPexelsVideos(query, {
    orientation,
    minDuration,
    perPage: 15,
    runId,
  });

  if (videos.length === 0) {
    throw new Error(`Pexels returned 0 videos for: "${query}"`);
  }

  const fresh = usedIds && usedIds.size > 0 ? videos.filter((v) => !usedIds.has(v.id)) : videos;
  const ordered = fresh.length > 0 ? fresh : videos;
  const reusing = fresh.length === 0 && usedIds && usedIds.size > 0;

  for (const video of ordered) {
    if (usedIds && usedIds.has(video.id) && !reusing) continue;
    const file = pickBestVideoFile(video, { maxHeight });
    if (!file) continue;
    if (usedIds && !usedIds.has(video.id)) usedIds.add(video.id);

    try {
      await downloadPexelsVideo(file, outPath);
      const author = video.user?.name ?? null;
      const reusedTag = reusing ? " (reused — no fresh matches)" : "";
      log(
        runId,
        "info",
        `Pexels clip: id=${video.id} ${file.width}x${file.height} ${video.duration}s by ${author ?? "?"}${reusedTag}`,
        { stage: "animate", data: { pexelsId: video.id, author, sourceUrl: video.url } }
      );
      return { pexelsId: video.id, author, sourceUrl: video.url };
    } catch (e) {
      if (usedIds && !reusing) usedIds.delete(video.id);
      const msg = e instanceof Error ? e.message : String(e);
      log(runId, "warn", `Pexels download failed (${video.id}), trying next: ${msg.slice(0, 150)}`, {
        stage: "animate",
      });
    }
  }
  throw new Error(`All ${videos.length} Pexels candidates failed to download for: "${query}"`);
}
