import { getSetting } from "../settings";
import { log } from "../logger";
import type { WordTiming } from "./elevenlabs-voiceover";

/**
 * Beat planner.
 *
 * 1. Fold the ElevenLabs word timeline into BEATS of ~secondsPerVisual each,
 *    preferring to end a beat on sentence punctuation.
 * 2. Decide each beat's layout:
 *      - the hook (beat 0) and an even spread of ~avatarPercent of beats show
 *        the recurring AVATAR. Beat 0 is full-screen "avatar"; the others are
 *        "split" (avatar shares the screen with a relevant visual).
 *      - every other beat is full-screen B-roll ("broll").
 * 3. For every visual beat (broll/split) ask Gemini for a short concrete visual
 *    search query, and assign its source (real footage vs AI) by realPercent,
 *    evenly spread across the timeline.
 *
 * Mirrors the base avatar-plan.ts but is driven by the script's own word timings
 * (not a transcription of an uploaded video) and adds the real/AI + image/video
 * source decision.
 */

export type BeatLayout = "avatar" | "split" | "broll";

export interface Beat {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  layout: BeatLayout;
  /** Concrete search/generation query for the B-roll. "" when layout = avatar. */
  visualQuery: string;
  /** Which visual engine fills the B-roll. Ignored when layout = avatar. */
  source: "real" | "ai";
}

const SENTENCE_END = /[.!?]["')\]]?$/;

/** Fold words into beats of ~targetSec, breaking preferentially at sentence ends. */
export function buildBeats(words: WordTiming[], targetSec: number): Omit<Beat, "layout" | "visualQuery" | "source">[] {
  const target = Math.max(1.5, targetSec) * 1000;
  const hardMax = target * 1.7;
  const beats: Omit<Beat, "layout" | "visualQuery" | "source">[] = [];
  let cur: WordTiming[] = [];
  let startMs = words[0]?.startMs ?? 0;

  const flush = () => {
    if (cur.length === 0) return;
    beats.push({
      index: beats.length,
      startMs,
      endMs: cur[cur.length - 1].endMs,
      text: cur.map((w) => w.word).join(" "),
    });
    cur = [];
  };

  for (const w of words) {
    if (cur.length === 0) startMs = w.startMs;
    cur.push(w);
    const dur = w.endMs - startMs;
    const atSentenceEnd = SENTENCE_END.test(w.word);
    if ((dur >= target && atSentenceEnd) || dur >= hardMax) {
      flush();
    }
  }
  flush();
  return beats;
}

interface GeminiQuery {
  index: number;
  visual_query?: string;
}

/**
 * Default "split"/visual prompt — the editable guidance that tells the model what
 * to show on screen for each beat. A channel's `visual_prompt` overrides this.
 * The JSON-contract scaffolding (numbered list + return format) is always added
 * around it, so a channel only edits the creative guidance, never the contract.
 */
export const DEFAULT_VISUAL_GUIDANCE =
  "You are sourcing B-roll for a documentary-style narration. For EACH numbered line below, " +
  "give a SHORT 3-8 word visual search query of CONCRETE nouns/places/actions that best illustrates it " +
  "(what a viewer should see on screen). Avoid abstract words; prefer searchable, real-world imagery.";

/** Ask Gemini for a concrete visual search query per beat. Best-effort. */
async function planVisualQueries(
  beats: { index: number; text: string }[],
  runId: string,
  guidance?: string
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const apiKey = getSetting("GOOGLE_API_KEY");
  if (!apiKey) {
    log(runId, "warn", "GOOGLE_API_KEY not set — using beat text as the visual query", { stage: "plan" });
    return out;
  }
  const model = getSetting("SCENE_SPLIT_MODEL") || "gemini-flash-latest";
  const numbered = beats.map((b) => `[${b.index}] ${b.text}`).join("\n");
  const prompt =
    `${(guidance && guidance.trim()) || DEFAULT_VISUAL_GUIDANCE}\n\n` +
    `${numbered}\n\n` +
    `Return STRICTLY a JSON array, one object per line IN ORDER: {"index": <int>, "visual_query": "<string>"}. No markdown.`;
  // Gemini under load returns 503 ("high demand") — retry with backoff, then
  // once on a fallback model, before giving up to the keyword fallback. A failed
  // plan is the single biggest quality killer (raw sentences → bad matches +
  // baked-in text), so we try hard here.
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.5, maxOutputTokens: 20000, thinkingConfig: { thinkingBudget: 0 } },
  });
  const models = [model, model !== "gemini-2.0-flash" ? "gemini-2.0-flash" : "gemini-flash-latest"];
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const useModel = attempt < 3 ? models[0] : models[1];
    if (attempt > 0) await new Promise((r) => setTimeout(r, 4000 * attempt));
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? text) as GeminiQuery[];
      for (const q of arr) {
        if (typeof q.index === "number" && q.visual_query) out.set(q.index, q.visual_query.trim());
      }
      return out;
    } catch (e) {
      lastErr = (e as Error).message;
      const transient = /503|429|overloaded|high demand|fetch failed|timeout/i.test(lastErr);
      if (!transient) break;
      log(runId, "warn", `Gemini attempt ${attempt + 1}/4 failed (${lastErr.slice(0, 100)}) — retrying`, { stage: "plan" });
    }
  }
  log(runId, "warn", `Visual-query planning failed (${lastErr.slice(0, 120)}) — using keyword fallback`, {
    stage: "plan",
  });
  return out;
}

// When Gemini is unavailable, we must NOT feed the raw narration sentence as the
// visual query — image models (nano-banana/Veo) render it as on-screen text, and
// stock search treats a whole sentence poorly. Reduce it to a few keywords.
const STOPWORDS = new Set(
  ("the a an and or but of to in on for with by at from as is are was were be been being this that these those it its " +
    "you your we our they their he she his her will would can could should what why how when where who whom about into " +
    "over under then than so just most more very really there here i me my do does did have has had not no yes if then " +
    "this video understand end").split(/\s+/)
);
function keywordsFrom(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return (kept.length ? kept : words).slice(0, 8).join(" ");
}

/** Evenly-spread `count` indices across `total` (always includes 0 if count>0). */
function spread(total: number, count: number): Set<number> {
  const picks = new Set<number>();
  if (count <= 0 || total <= 0) return picks;
  if (count >= total) {
    for (let i = 0; i < total; i++) picks.add(i);
    return picks;
  }
  const step = total / count;
  for (let i = 0; picks.size < count && i < total; i++) picks.add(Math.floor(i * step));
  return picks;
}

export async function planBeats(
  words: WordTiming[],
  opts: {
    secondsPerVisual: number;
    avatarPercent: number;
    realPercent: number;
    hasAvatar: boolean;
    runId: string;
    /** Channel's editable visual/"split" guidance; default used when empty. */
    visualPrompt?: string;
  }
): Promise<Beat[]> {
  const base = buildBeats(words, opts.secondsPerVisual);
  if (base.length === 0) return [];

  // 1. Choose avatar beats (only if an avatar is selected for this run).
  const avatarSet = new Set<number>();
  if (opts.hasAvatar && opts.avatarPercent > 0) {
    const count = Math.max(1, Math.round((base.length * Math.min(100, opts.avatarPercent)) / 100));
    for (const i of spread(base.length, count)) avatarSet.add(i);
    avatarSet.add(0); // always open on the avatar (the hook)
  }

  // 2. Visual queries from Gemini for the non-avatar (and split) beats.
  const visualBeats = base.filter((b) => !avatarSet.has(b.index) || b.index !== 0);
  const queries = await planVisualQueries(
    visualBeats.map((b) => ({ index: b.index, text: b.text })),
    opts.runId,
    opts.visualPrompt
  );

  // 3. Assemble beats with layout.
  const beats: Beat[] = base.map((b) => {
    let layout: BeatLayout = "broll";
    if (avatarSet.has(b.index)) layout = b.index === 0 ? "avatar" : "split";
    const visualQuery = layout === "avatar" ? "" : queries.get(b.index) || keywordsFrom(b.text);
    return { ...b, layout, visualQuery, source: "ai" };
  });

  // 4. Assign real vs AI across the visual beats (broll + split), evenly spread.
  const visual = beats.filter((b) => b.layout !== "avatar");
  const realCount = Math.round((visual.length * Math.max(0, Math.min(100, opts.realPercent))) / 100);
  const realOrdinals = spread(visual.length, realCount);
  let ordinal = 0;
  for (const b of beats) {
    if (b.layout === "avatar") continue;
    b.source = realOrdinals.has(ordinal) ? "real" : "ai";
    ordinal++;
  }

  const c = { avatar: 0, split: 0, broll: 0 };
  for (const b of beats) c[b.layout]++;
  const realN = beats.filter((b) => b.layout !== "avatar" && b.source === "real").length;
  const aiN = beats.filter((b) => b.layout !== "avatar" && b.source === "ai").length;
  log(
    opts.runId,
    "success",
    `Plan: ${beats.length} beats · avatar=${c.avatar} split=${c.split} broll=${c.broll} · real=${realN} ai=${aiN}`,
    { stage: "plan" }
  );
  return beats;
}
