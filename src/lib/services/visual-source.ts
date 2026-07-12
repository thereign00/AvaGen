import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSetting } from "../settings";
import { log } from "../logger";
import { kenBurns } from "./ken-burns";
import { animateScene } from "./img2vid";
import { generateImageUrl, generateVideoUrl, downloadKie } from "./kie";
import {
  searchPexelsVideos,
  pickBestVideoFile,
  visualPromptToQuery,
  type Orientation,
} from "./stock-footage";
import type { Scene } from "./scene-split";
import type { Beat } from "./studio-plan";

/**
 * Visual source — produces ONE mp4 per visual beat.
 *
 * For source = "real": search the configured footage providers in priority
 * order. A video hit is downloaded as-is; a still-image hit gets the Ken Burns
 * zoom into a clip. For source = "ai" (or when every real provider fails): the
 * 69labs/Grok text-to-video engine generates the clip. A beat is never empty —
 * real failures fall back to AI, AI failure throws.
 *
 * Default safe stack (licensed/CC): Pexels, Pixabay, Openverse, Wikimedia.
 * yt-dlp is an opt-in power source, OFF by default (copyright/ToS risk).
 * See docs/DESIGN.md.
 */

export interface VisualResult {
  path: string;
  kind: "video" | "image" | "ai";
  provider: string;
  attribution?: { author?: string | null; sourceUrl?: string; license?: string | null };
}

type ProviderKind = "video" | "image";
interface ProviderHit {
  kind: ProviderKind;
  /** Direct download URL (video file or image file). */
  url: string;
  /** Stable dedupe id, e.g. "pexels:123". */
  dedupeId: string;
  author?: string | null;
  sourceUrl?: string;
  license?: string | null;
}

function orientationSetting(): Orientation {
  const o = (getSetting("STOCK_FOOTAGE_ORIENTATION") || "landscape").toLowerCase();
  return o === "portrait" || o === "square" ? (o as Orientation) : "landscape";
}

async function downloadToFile(url: string, outPath: string, headers?: Record<string, string>): Promise<void> {
  const resp = await fetch(url, headers ? { headers } : undefined);
  if (!resp.ok) throw new Error(`download ${resp.status}: ${url.slice(0, 120)}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength === 0) throw new Error(`empty download: ${url.slice(0, 120)}`);
  fs.writeFileSync(outPath, buf);
}

const UA = "FacelessVideoGenerator/0.1 (local video tool; contact: operator)";

// ── Providers ────────────────────────────────────────────────────────────────

/**
 * `minDurSec` = the beat's duration. A clip shorter than the beat gets looped by
 * the compositor, which reads as a jarring visible repeat — so we ask Pexels for
 * clips that cover the whole beat first, and only fall back to the global
 * minimum (shorter clips) when that returns nothing.
 */
async function pexelsSearch(query: string, runId: string, minDurSec?: number): Promise<ProviderHit[]> {
  const globalMin = Math.max(0, Number(getSetting("STOCK_FOOTAGE_MIN_DURATION") || "3"));
  const wanted = Math.max(globalMin, Math.ceil(minDurSec ?? 0));
  const maxH = Math.max(360, Number(getSetting("STOCK_FOOTAGE_MAX_HEIGHT") || "1080"));

  const search = (minDuration: number) =>
    searchPexelsVideos(query, { orientation: orientationSetting(), minDuration, perPage: 15, runId });

  let videos = await search(wanted);
  if (videos.length === 0 && wanted > globalMin) videos = await search(globalMin);

  const hits: ProviderHit[] = [];
  for (const v of videos) {
    const file = pickBestVideoFile(v, { maxHeight: maxH });
    if (file) {
      hits.push({
        kind: "video",
        url: file.link,
        dedupeId: `pexels:${v.id}`,
        author: v.user?.name ?? null,
        sourceUrl: v.url,
        license: "Pexels License",
      });
    }
  }
  return hits;
}

async function pixabayVideoSearch(query: string, minDurSec?: number): Promise<ProviderHit[]> {
  const key = getSetting("PIXABAY_API_KEY");
  if (!key) return [];
  const orient = orientationSetting();
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query.slice(0, 100));
  url.searchParams.set("video_type", "film");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", "20");
  if (orient !== "square") url.searchParams.set("orientation", orient === "portrait" ? "vertical" : "horizontal");
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`Pixabay videos ${resp.status}`);
  const data = (await resp.json()) as {
    hits?: { id: number; duration?: number; pageURL?: string; user?: string; videos?: Record<string, { url: string; width: number; height: number }> }[];
  };
  const all = (data.hits ?? [])
    .map((h): (ProviderHit & { durationSec?: number }) | null => {
      const v = h.videos?.large?.url ? h.videos.large : h.videos?.medium;
      if (!v?.url) return null;
      return { kind: "video", url: v.url, dedupeId: `pixabay:${h.id}`, author: h.user ?? null, sourceUrl: h.pageURL, license: "Pixabay License", durationSec: h.duration };
    })
    .filter((x): x is ProviderHit & { durationSec?: number } => x !== null);
  // Prefer clips that cover the whole beat (no visible looping); fall back to all.
  const want = Math.ceil(minDurSec ?? 0);
  const covering = want > 0 ? all.filter((h) => (h.durationSec ?? 0) >= want) : all;
  return covering.length > 0 ? covering : all;
}

async function pixabayImageSearch(query: string): Promise<ProviderHit[]> {
  const key = getSetting("PIXABAY_API_KEY");
  if (!key) return [];
  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query.slice(0, 100));
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("min_width", "1280");
  url.searchParams.set("orientation", orientationSetting() === "portrait" ? "vertical" : "horizontal");
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`Pixabay images ${resp.status}`);
  const data = (await resp.json()) as {
    hits?: { id: number; pageURL?: string; user?: string; largeImageURL?: string; fullHDURL?: string }[];
  };
  return (data.hits ?? [])
    .map((h): ProviderHit | null => {
      const u = h.fullHDURL || h.largeImageURL;
      if (!u) return null;
      return { kind: "image", url: u, dedupeId: `pixabay-img:${h.id}`, author: h.user ?? null, sourceUrl: h.pageURL, license: "Pixabay License" };
    })
    .filter((x): x is ProviderHit => x !== null);
}

async function openverseSearch(query: string): Promise<ProviderHit[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  url.searchParams.set("license", "pdm,cc0,by,by-sa");
  url.searchParams.set("license_type", "commercial,modification");
  url.searchParams.set("page_size", "20");
  const headers: Record<string, string> = { "User-Agent": UA };
  const token = getSetting("OPENVERSE_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`Openverse ${resp.status}`);
  const data = (await resp.json()) as {
    results?: { id: string; url?: string; creator?: string; foreign_landing_url?: string; license?: string; attribution?: string }[];
  };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r): ProviderHit => ({
      kind: "image",
      url: r.url as string,
      dedupeId: `openverse:${r.id}`,
      author: r.creator ?? null,
      sourceUrl: r.foreign_landing_url,
      license: r.license ?? null,
    }));
}

async function wikimediaSearch(query: string): Promise<ProviderHit[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", query);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "20");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size|mime|extmetadata");
  url.searchParams.set("iiurlwidth", "1920");
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error(`Wikimedia ${resp.status}`);
  const data = (await resp.json()) as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { url?: string; thumburl?: string; mime?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }> };
  };
  const pages = data.query?.pages ? Object.values(data.query.pages) : [];
  const hits: ProviderHit[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime = info.mime ?? "";
    // Stills only here (Commons video is webm and would need transcode); prefer the 1920 thumb.
    if (!/^image\//.test(mime)) continue;
    const u = info.thumburl || info.url;
    if (!u) continue;
    hits.push({
      kind: "image",
      url: u,
      dedupeId: `wikimedia:${p.title}`,
      author: info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "").slice(0, 120) ?? null,
      sourceUrl: info.descriptionurl,
      license: info.extmetadata?.LicenseShortName?.value ?? null,
    });
  }
  return hits;
}

const PROVIDERS: Record<string, (q: string, runId: string, minDurSec?: number) => Promise<ProviderHit[]>> = {
  pexels: (q, runId, minDurSec) => pexelsSearch(q, runId, minDurSec),
  pixabay: async (q, _runId, minDurSec) => [...(await safe(pixabayVideoSearch(q, minDurSec))), ...(await safe(pixabayImageSearch(q)))],
  openverse: (q) => openverseSearch(q),
  wikimedia: (q) => wikimediaSearch(q),
};

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch {
    return [];
  }
}

function configuredProviders(): string[] {
  const raw = getSetting("FOOTAGE_SOURCES") || "pexels,pixabay,openverse,wikimedia";
  const list = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in PROVIDERS || s === "youtube");
  return list.length > 0 ? list : ["pexels", "pixabay", "openverse", "wikimedia"];
}

/**
 * yt-dlp YouTube source — OPT-IN and OFF by default (copyright / ToS risk).
 * Only runs when YT_DLP_ENABLED = "1" AND "youtube" is in FOOTAGE_SOURCES.
 * Searches without an API key (ytsearch), then downloads a beat-length segment.
 * The operator is responsible for the legality of anything published.
 */
async function acquireYouTube(
  runId: string,
  query: string,
  beatDurSec: number,
  outPath: string,
  usedIds: Set<string>
): Promise<VisualResult | null> {
  const bin = getSetting("YT_DLP_PATH") || "yt-dlp";
  const need = Math.ceil(beatDurSec) + 1;

  // 1. Search (metadata only, no download).
  const search = spawnSync(
    bin,
    [`ytsearch8:${query}`, "--dump-json", "--flat-playlist", "--no-warnings"],
    { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (search.status !== 0 || !search.stdout) {
    log(runId, "debug", `yt-dlp search failed: ${(search.stderr || "").slice(0, 140)}`, { stage: "visual" });
    return null;
  }
  const candidates = search.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { id?: string; duration?: number };
      } catch {
        return null;
      }
    })
    .filter((c): c is { id: string; duration?: number } => !!c?.id && !usedIds.has(`youtube:${c.id}`))
    .filter((c) => (c.duration == null ? true : c.duration >= need && c.duration <= 3600));

  // 2. Download a beat-length segment from a mid offset (skip intros).
  for (const c of candidates.slice(0, 3)) {
    usedIds.add(`youtube:${c.id}`);
    const start = c.duration && c.duration > 20 ? 8 : 0;
    const dl = spawnSync(
      bin,
      [
        "--download-sections", `*${start}-${start + need}`,
        "--force-keyframes-at-cuts",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--no-warnings", "--no-playlist",
        "-o", outPath,
        `https://www.youtube.com/watch?v=${c.id}`,
      ],
      { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 }
    );
    if (dl.status === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      log(runId, "info", `Beat: YouTube clip via yt-dlp (${c.id}, ${query})`, { stage: "visual" });
      return {
        path: outPath,
        kind: "video",
        provider: "youtube",
        attribution: { sourceUrl: `https://www.youtube.com/watch?v=${c.id}`, license: "YouTube (user responsibility)" },
      };
    }
  }
  return null;
}

/** Human-readable text for a hit (slug from its page URL), for relevance scoring. */
function hitLabel(h: ProviderHit): string {
  try {
    const p = new URL(h.sourceUrl || "").pathname;
    const slug = p.split("/").filter(Boolean).pop() || "";
    const words = slug.replace(/\d+/g, " ").replace(/[-_]+/g, " ").trim();
    if (words.length > 3) return words;
  } catch {}
  return h.dedupeId.replace(/^[a-z-]+:/, "").replace(/[-_]+/g, " ");
}

/**
 * Relevance gate (REAL_MATCH_THRESHOLD > 0): one Gemini call scores how well
 * each candidate's title matches the visual query (0–100); hits below the bar
 * are dropped, so generic stock results fall through to the next source or to
 * AI generation. Fail-open: returns null (gate off) when disabled, no Gemini
 * key, or on any error — a run must never fail because of the gate.
 */
async function gateByRelevance(
  runId: string,
  query: string,
  hits: ProviderHit[]
): Promise<ProviderHit[] | null> {
  const threshold = Math.max(0, Math.min(100, Number(getSetting("REAL_MATCH_THRESHOLD") || "0")));
  if (threshold <= 0 || hits.length === 0) return null;
  const apiKey = getSetting("GOOGLE_API_KEY");
  if (!apiKey) return null;

  const candidates = hits.slice(0, 8);
  const lines = candidates.map((h, i) => `[${i}] ${hitLabel(h)}`).join("\n");
  const prompt =
    `Visual query: "${query}"\n\nStock footage candidates (one per line as "[index] title"):\n${lines}\n\n` +
    `For EACH candidate, score 0-100 how well it visually matches the query (100 = exactly this subject). ` +
    `Return STRICTLY a JSON array: [{"i": <int>, "score": <int>}]. No markdown.`;
  try {
    const model = getSetting("SCENE_SPLIT_MODEL") || "gemini-flash-latest";
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? text) as { i: number; score: number }[];
    const scores = new Map(arr.map((x) => [Number(x.i), Number(x.score)]));
    const passing = candidates
      .map((h, i) => ({ h, score: scores.get(i) ?? 0 }))
      .filter((x) => x.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.h);
    log(runId, "debug", `Relevance gate: ${passing.length}/${candidates.length} hits >= ${threshold} for "${query}"`, {
      stage: "visual",
    });
    return passing;
  } catch {
    return null; // fail-open
  }
}

/** Produce an mp4 for a real-footage beat using one configured provider. */
async function acquireReal(
  runId: string,
  beat: Beat,
  beatDurSec: number,
  outPath: string,
  usedIds: Set<string>,
  resolution?: string
): Promise<VisualResult | null> {
  const query = visualPromptToQuery(beat.visualQuery || beat.text);
  if (!query) return null;
  const tmpDir = os.tmpdir();

  for (const name of configuredProviders()) {
    // Opt-in YouTube source (yt-dlp) — handled specially (it downloads itself).
    if (name === "youtube") {
      if (getSetting("YT_DLP_ENABLED") !== "1") continue;
      try {
        const yt = await acquireYouTube(runId, query, beatDurSec, outPath, usedIds);
        if (yt) return yt;
      } catch (e) {
        log(runId, "debug", `youtube source failed: ${(e as Error).message.slice(0, 120)}`, { stage: "visual" });
      }
      continue;
    }

    let hits: ProviderHit[] = [];
    try {
      hits = await PROVIDERS[name](query, runId, beatDurSec);
    } catch (e) {
      log(runId, "debug", `${name} search failed: ${(e as Error).message.slice(0, 120)}`, { stage: "visual" });
      continue;
    }
    const fresh = hits.filter((h) => !usedIds.has(h.dedupeId));
    let ordered = fresh.length > 0 ? fresh : hits;
    const gated = await gateByRelevance(runId, query, ordered);
    if (gated) {
      if (gated.length === 0) {
        log(runId, "info", `Beat ${beat.index}: ${name} results below relevance threshold — trying next source`, {
          stage: "visual",
        });
        continue;
      }
      ordered = gated;
    }
    const pick = ordered[0];
    if (!pick) continue;
    usedIds.add(pick.dedupeId);

    try {
      if (pick.kind === "video") {
        await downloadToFile(pick.url, outPath, { "User-Agent": UA });
        log(runId, "info", `Beat ${beat.index}: real video via ${name} (${query})`, { stage: "visual" });
        return { path: outPath, kind: "video", provider: name, attribution: pick };
      }
      // image → Ken Burns
      const tmpImg = path.join(tmpDir, `kb_${runId.slice(0, 8)}_${beat.index}${path.extname(new URL(pick.url).pathname) || ".jpg"}`);
      await downloadToFile(pick.url, tmpImg, { "User-Agent": UA });
      kenBurns(tmpImg, outPath, beatDurSec, beat.index % 2 === 1, resolution);
      try {
        fs.unlinkSync(tmpImg);
      } catch {}
      log(runId, "info", `Beat ${beat.index}: real still + Ken Burns via ${name} (${query})`, { stage: "visual" });
      return { path: outPath, kind: "image", provider: name, attribution: pick };
    } catch (e) {
      log(runId, "debug", `${name} fetch/render failed for beat ${beat.index}: ${(e as Error).message.slice(0, 120)}`, {
        stage: "visual",
      });
      // try next provider
    }
  }
  return null;
}

function aiAspect(resolution?: string): string {
  const m = (resolution || "").match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (h > w) return "9:16";
    if (w === h) return "1:1";
    return "16:9";
  }
  const o = orientationSetting();
  return o === "portrait" ? "9:16" : o === "square" ? "1:1" : "16:9";
}

/** AI b-roll for a beat — kie.ai (nano-banana image + Ken Burns, or Veo video) or 69labs/Grok. */
async function acquireAi(
  runId: string,
  beat: Beat,
  beatDurSec: number,
  outPath: string,
  aiStyle?: string,
  resolution?: string
): Promise<VisualResult> {
  const provider = (getSetting("AI_PROVIDER") || "kie").toLowerCase();
  const style = (aiStyle ?? getSetting("AI_IMAGE_STYLE")) || "";
  // Suppress baked-in captions/labels that nano-banana/Veo tend to render.
  const noText = "no text, no captions, no subtitles, no words, no letters, no watermark, no logo";
  const prompt = [beat.visualQuery || beat.text, style, noText].filter(Boolean).join(", ");
  const aspect = aiAspect(resolution);

  if (provider === "kie") {
    const media = (getSetting("KIE_AI_MEDIA") || "image").toLowerCase();
    if (media === "video") {
      const url = await generateVideoUrl(runId, prompt, aspect, Math.ceil(beatDurSec));
      await downloadKie(url, outPath);
      log(runId, "info", `Beat ${beat.index}: AI video via kie.ai/Veo`, { stage: "visual" });
      return { path: outPath, kind: "ai", provider: "kie:veo" };
    }
    // nano-banana image → Ken Burns
    const url = await generateImageUrl(runId, prompt, aspect);
    const tmpImg = path.join(os.tmpdir(), `kie_${runId.slice(0, 8)}_${beat.index}.png`);
    await downloadKie(url, tmpImg);
    kenBurns(tmpImg, outPath, beatDurSec, beat.index % 2 === 1, resolution);
    try {
      fs.unlinkSync(tmpImg);
    } catch {}
    log(runId, "info", `Beat ${beat.index}: AI still via kie.ai/nano-banana + Ken Burns`, { stage: "visual" });
    return { path: outPath, kind: "ai", provider: "kie:nano-banana" };
  }

  // 69labs / Grok text-to-video (reuses the existing engine + retries).
  const dir = path.dirname(outPath);
  const pseudo: Scene = {
    index: beat.index,
    text: beat.text,
    visual_prompt: prompt,
    duration_hint_sec: Math.max(2, Math.round(beatDurSec)),
  };
  const generated = await animateScene(runId, pseudo, null, dir, { motionOverride: null });
  if (!generated) throw new Error(`AI generation produced no clip for beat ${beat.index}`);
  if (path.resolve(generated) !== path.resolve(outPath)) {
    fs.renameSync(generated, outPath);
  }
  return { path: outPath, kind: "ai", provider: "69labs" };
}

/**
 * Acquire the visual mp4 for one beat. Real beats try the configured providers,
 * then fall back to AI. AI beats go straight to generation.
 */
export async function acquireVisual(
  runId: string,
  beat: Beat,
  outPath: string,
  usedIds: Set<string>,
  opts: { aiStyle?: string; resolution?: string } = {}
): Promise<VisualResult> {
  const beatDurSec = Math.max(0.8, (beat.endMs - beat.startMs) / 1000);
  if (beat.source === "real") {
    const real = await acquireReal(runId, beat, beatDurSec, outPath, usedIds, opts.resolution);
    if (real) return real;
    log(runId, "warn", `Beat ${beat.index}: no real footage found — falling back to AI`, { stage: "visual" });
  }
  return acquireAi(runId, beat, beatDurSec, outPath, opts.aiStyle, opts.resolution);
}
