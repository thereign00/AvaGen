import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSetting } from "../settings";
import { log } from "../logger";
import { probeDurationSafe } from "./video-assemble";
import { synthesizeFullScript } from "./tts";

/**
 * ElevenLabs full-script voiceover WITH word timings.
 *
 * The narration is one continuous ElevenLabs performance over the whole
 * script. We use the `/with-timestamps` endpoint so we get per-character timing
 * in the SAME call — no separate Whisper pass — and fold characters into words.
 * Long scripts are chunked at sentence boundaries (model char limit) and each
 * chunk's timings are offset by the cumulative audio duration so the word list
 * is one global timeline. See docs/DESIGN.md.
 */

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface Voiceover {
  /** Path to the full voiceover MP3. */
  filePath: string;
  durationSec: number;
  /** Words on a single global timeline (ms from start of the full audio). */
  words: WordTiming[];
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
interface TimestampsResponse {
  audio_base64: string;
  alignment: Alignment | null;
  normalized_alignment: Alignment | null;
}

function modelCharLimit(model: string): number {
  if (/flash|turbo/i.test(model)) return 38000; // 40k cap, leave headroom
  if (/v3/i.test(model)) return 2800; // 3k cap
  return 9500; // multilingual_v2: 10k cap
}

/** Split text into chunks under `limit` chars, never breaking a sentence. */
function chunkScript(text: string, limit: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > limit && cur) {
      chunks.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.length > 0 ? chunks : [text];
}

/** Group an alignment's characters into words, offset by `offsetMs`. */
function alignmentToWords(a: Alignment, offsetMs: number): WordTiming[] {
  const words: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < a.characters.length; i++) {
    const c = a.characters[i];
    const startMs = Math.round(a.character_start_times_seconds[i] * 1000) + offsetMs;
    const endMs = Math.round(a.character_end_times_seconds[i] * 1000) + offsetMs;
    if (/\s/.test(c)) {
      if (cur) {
        words.push(cur);
        cur = null;
      }
    } else {
      if (!cur) cur = { word: "", startMs, endMs };
      cur.word += c;
      cur.endMs = endMs;
    }
  }
  if (cur) words.push(cur);
  return words;
}

function voiceSettings(): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  const num = (k: string) => {
    const n = parseFloat(getSetting(k as Parameters<typeof getSetting>[0]));
    return Number.isFinite(n) ? n : NaN;
  };
  const stability = num("TTS_STABILITY");
  const similarity = num("TTS_SIMILARITY_BOOST");
  const style = num("TTS_STYLE");
  const speed = num("TTS_SPEED");
  const boost = getSetting("TTS_USE_SPEAKER_BOOST");
  if (!Number.isNaN(stability)) out.stability = Math.max(0, Math.min(1, stability));
  if (!Number.isNaN(similarity)) out.similarity_boost = Math.max(0, Math.min(1, similarity));
  if (!Number.isNaN(style)) out.style = Math.max(0, Math.min(1, style));
  if (!Number.isNaN(speed)) out.speed = Math.max(0.7, Math.min(1.2, speed));
  if (boost === "1") out.use_speaker_boost = true;
  else if (boost === "0") out.use_speaker_boost = false;
  return out;
}

/**
 * Voiceover router. ElevenLabs (direct) is the default and gives native per-word
 * timestamps. Other providers (69labs / HeyGen / MiniMax via the shared TTS
 * engine) return audio only, so we recover word timings with Groq Whisper, and
 * fall back to a proportional split if no Groq key is configured.
 */
export async function synthesizeVoiceover(
  runId: string,
  script: string,
  outDir: string,
  opts: { voiceOverride?: string | null } = {}
): Promise<Voiceover> {
  const provider = (getSetting("VOICEOVER_PROVIDER") || "elevenlabs").toLowerCase();
  if (provider === "elevenlabs") {
    return synthesizeElevenLabs(runId, script, outDir, opts);
  }
  return synthesizeViaProvider(runId, script, outDir, provider, opts);
}

/**
 * Non-ElevenLabs voiceover: synthesize one continuous mp3 through the shared TTS
 * engine (69labs / heygen / minimax / openai), then align word timings.
 */
async function synthesizeViaProvider(
  runId: string,
  script: string,
  outDir: string,
  provider: string,
  opts: { voiceOverride?: string | null }
): Promise<Voiceover> {
  log(runId, "info", `Voiceover via ${provider} (timing via Groq Whisper)`, { stage: "voiceover" });
  const outPath = path.join(outDir, "voiceover.mp3");
  const { durationSec } = await synthesizeFullScript(runId, script.trim(), outPath, {
    voiceOverride: opts.voiceOverride,
    provider,
  });
  const words = await alignWords(runId, outPath, script, durationSec);
  log(runId, "success", `Voiceover ready: ${durationSec.toFixed(1)}s, ${words.length} words timed`, {
    stage: "voiceover",
  });
  return { filePath: outPath, durationSec, words };
}

/**
 * Recover per-word timings for an mp3. Prefers Groq Whisper word timestamps;
 * falls back to a proportional even split (so a run never fails just because no
 * Groq key is set).
 */
async function alignWords(runId: string, mp3Path: string, script: string, durationSec: number): Promise<WordTiming[]> {
  const groqKey = getSetting("GROQ_API_KEY");
  if (groqKey) {
    try {
      const w = await whisperWords(mp3Path, groqKey);
      if (w.length > 0) return w;
    } catch (e) {
      log(runId, "warn", `Whisper alignment failed (${(e as Error).message.slice(0, 120)}) — using proportional timing`, {
        stage: "voiceover",
      });
    }
  } else {
    log(runId, "warn", "No GROQ_API_KEY — using proportional word timing (add a free Groq key for accurate sync)", {
      stage: "voiceover",
    });
  }
  return proportionalWords(script, durationSec);
}

/** Groq Whisper (whisper-large-v3) word-level timestamps. */
async function whisperWords(mp3Path: string, groqKey: string): Promise<WordTiming[]> {
  const ff = getSetting("FFMPEG_PATH") || "ffmpeg";
  const wav = path.join(os.tmpdir(), `vo-align-${process.pid}-${Date.now()}.mp3`);
  const ex = spawnSync(ff, ["-y", "-i", mp3Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", wav], { stdio: "pipe" });
  if (ex.status !== 0) throw new Error("ffmpeg audio extract for alignment failed");
  try {
    const fd = new FormData();
    fd.append("file", new Blob([fs.readFileSync(wav)], { type: "audio/mpeg" }), "audio.mp3");
    fd.append("model", "whisper-large-v3");
    fd.append("response_format", "verbose_json");
    fd.append("timestamp_granularities[]", "word");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: fd,
    });
    if (!r.ok) throw new Error(`Groq Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { words?: { word: string; start: number; end: number }[] };
    return (j.words ?? [])
      .map((w) => ({ word: (w.word || "").trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }))
      .filter((w) => w.word.length > 0);
  } finally {
    try {
      fs.unlinkSync(wav);
    } catch {}
  }
}

/** Even split of the script's words across the audio duration (no API needed). */
function proportionalWords(script: string, durationSec: number): WordTiming[] {
  const tokens = script.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const totalMs = Math.max(1, Math.round(durationSec * 1000));
  const per = totalMs / tokens.length;
  return tokens.map((word, i) => ({
    word,
    startMs: Math.round(i * per),
    endMs: Math.round((i + 1) * per),
  }));
}

async function synthesizeElevenLabs(
  runId: string,
  script: string,
  outDir: string,
  opts: { voiceOverride?: string | null } = {}
): Promise<Voiceover> {
  const apiKey = getSetting("ELEVENLABS_API_KEY");
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set — paste it in /settings.");
  const voiceId =
    opts.voiceOverride?.trim() || getSetting("ELEVENLABS_VOICE_ID") || getSetting("TTS_VOICE_ID");
  if (!voiceId) throw new Error("No ElevenLabs voice — set ELEVENLABS_VOICE_ID in /settings.");
  const model = getSetting("ELEVENLABS_MODEL") || "eleven_multilingual_v2";

  const chunks = chunkScript(script.trim(), modelCharLimit(model));
  log(runId, "info", `ElevenLabs voiceover: ${chunks.length} chunk(s), model ${model}`, { stage: "voiceover" });

  const settings = voiceSettings();
  const chunkPaths: string[] = [];
  const allWords: WordTiming[] = [];
  let offsetMs = 0;

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i].trim();
    if (!text) continue;
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: model,
          ...(Object.keys(settings).length ? { voice_settings: settings } : {}),
        }),
      }
    );
    if (!resp.ok) {
      throw new Error(`ElevenLabs ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const json = (await resp.json()) as TimestampsResponse;
    if (!json.audio_base64) throw new Error("ElevenLabs returned no audio");

    const chunkPath = path.join(outDir, `voiceover_${String(i).padStart(2, "0")}.mp3`);
    fs.writeFileSync(chunkPath, Buffer.from(json.audio_base64, "base64"));
    chunkPaths.push(chunkPath);

    const align = json.alignment ?? json.normalized_alignment;
    if (align && align.characters?.length) {
      allWords.push(...alignmentToWords(align, offsetMs));
      const lastEnd = align.character_end_times_seconds[align.character_end_times_seconds.length - 1] || 0;
      offsetMs += Math.round(lastEnd * 1000);
    } else {
      // No alignment came back — offset by measured chunk duration so later
      // chunks stay on the global timeline (words for this chunk are lost).
      offsetMs += Math.round((await probeDurationSafe(chunkPath)) * 1000);
      log(runId, "warn", `Chunk ${i} returned no alignment — word timing for it is unavailable`, { stage: "voiceover" });
    }
    log(runId, "info", `Voiceover chunk ${i + 1}/${chunks.length} ok`, { stage: "voiceover" });
  }

  if (chunkPaths.length === 0) throw new Error("ElevenLabs produced no audio");

  // Concatenate chunk MP3s into one voiceover.mp3 (stream copy).
  const outPath = path.join(outDir, "voiceover.mp3");
  if (chunkPaths.length === 1) {
    fs.copyFileSync(chunkPaths[0], outPath);
  } else {
    const listPath = path.join(outDir, "voiceover_concat.txt");
    fs.writeFileSync(
      listPath,
      chunkPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
      "utf-8"
    );
    const ff = getSetting("FFMPEG_PATH") || "ffmpeg";
    const r = spawnSync(ff, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], {
      stdio: "pipe",
    });
    if (r.status !== 0) throw new Error(`ffmpeg voiceover concat failed: ${r.stderr?.toString().slice(-300)}`);
    try {
      fs.unlinkSync(listPath);
    } catch {}
  }
  for (const p of chunkPaths) {
    if (p !== outPath) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }

  const durationSec = await probeDurationSafe(outPath);
  log(runId, "success", `Voiceover ready: ${durationSec.toFixed(1)}s, ${allWords.length} words timed`, {
    stage: "voiceover",
  });
  return { filePath: outPath, durationSec, words: allWords };
}
