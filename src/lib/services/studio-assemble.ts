import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSetting } from "../settings";
import { log } from "../logger";
import type { Beat } from "./studio-plan";

/**
 * Studio compositor.
 *
 * Renders every beat WITH its own audio, then concatenates them (hard cuts):
 *   "avatar" → the HeyGen talking-head clip + its OWN audio (perfect lip-sync)
 *   "split"  → HeyGen avatar (left, drives length+audio) + the beat's visual (right)
 *   "broll"  → the beat's visual full-screen + the master voiceover slice for it
 * Avatar/split beats reuse the HeyGen clip's own audio so the lips never drift
 * from a separately-overlaid track. Each avatar clip is generated from that
 * beat's audio slice (cheap — only the ~15% of beats that show the avatar). All
 * beats share identical encode params, so the final concat is a stream copy and
 * the concatenated audio is the full narration in order.
 */

export interface RenderBeat extends Beat {
  /** Visual mp4 for broll/split beats; null for full "avatar" beats. */
  visualPath: string | null;
  /** Per-beat HeyGen talking-head clip for avatar/split beats; null otherwise. */
  avatarClipPath: string | null;
}

function dims(resolution?: string): { w: number; h: number; fps: number } {
  const res = resolution || getSetting("VIDEO_RESOLUTION") || "1920x1080";
  const m = res.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  const fps = Math.max(1, Number(getSetting("VIDEO_FPS") || "30"));
  return m ? { w: Number(m[1]), h: Number(m[2]), fps } : { w: 1920, h: 1080, fps };
}

function ffmpegBin(): string {
  return getSetting("FFMPEG_PATH") || "ffmpeg";
}

function runFfmpeg(args: string[]): void {
  const r = spawnSync(ffmpegBin(), args, { stdio: "pipe" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (rc=${r.status}): ${(r.stderr?.toString() ?? "").slice(-400)}`);
  }
}

/** Video + audio encode params (legacy or when audio is included). */
function encodeAV(fps: number): string[] {
  return [
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    "-y",
  ];
}

/** Silent video encode params (for exact beat clips before continuous master audio muxing). */
function encodeV(fps: number): string[] {
  return [
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    "-y",
  ];
}

/** Slice [startMs,endMs] of the voiceover into its own mp3 (for HeyGen lip-sync). */
export function sliceAudio(voiceoverPath: string, startMs: number, endMs: number, outPath: string): void {
  const ss = (startMs / 1000).toFixed(3);
  const t = Math.max(0.2, (endMs - startMs) / 1000).toFixed(3);
  runFfmpeg(["-ss", ss, "-t", t, "-i", voiceoverPath, "-c:a", "libmp3lame", "-b:a", "192k", "-y", outPath]);
}

/**
 * Detect a clip's non-black content rectangle ("w:h:x:y") via cropdetect, so we
 * can strip the black pillarbox bars HeyGen adds around a portrait talking-photo
 * (otherwise the avatar shows as a phone-style 9:16 strip inside the 16:9 frame).
 * Returns null when nothing meaningful is detected.
 */
function contentCrop(clipPath: string): string | null {
  // limit=48: video is limited-range (black = Y'16), and HeyGen's near-black
  // backgrounds (e.g. #101418 → Y'≈33) sit ABOVE the cropdetect default of 24,
  // which silently disabled the crop. 48 catches black and dark-gray bars.
  const r = spawnSync(
    ffmpegBin(),
    ["-ss", "0.5", "-i", clipPath, "-vf", "cropdetect=48:2:0", "-frames:v", "60", "-an", "-f", "null", "-"],
    { stdio: "pipe", encoding: "utf8" }
  );
  const out = (r.stderr ?? "").toString();
  const m = [...out.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)];
  return m.length ? m[m.length - 1][1] : null;
}

/**
 * Render one beat clip (SILENT video of exact duration durSec) to outPath.
 * By producing exact-duration silent clips for avatar, split, and broll beats and then
 * muxing the continuous master voiceover over the concatenated video in assembleStudioVideo,
 * we eliminate all audio boundary cuts, AAC priming gaps, and HeyGen length desyncs entirely.
 */
function renderBeat(
  beat: RenderBeat,
  voiceoverPath: string,
  outPath: string,
  dim: { w: number; h: number; fps: number }
): void {
  const { w, h, fps } = dim;
  const durSec = Math.max(0.2, (beat.endMs - beat.startMs) / 1000).toFixed(3);
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps}`;

  // Strip HeyGen's pillarbox bars from the avatar clip so it fills the frame.
  const avCrop = beat.avatarClipPath ? contentCrop(beat.avatarClipPath) : null;
  const avPre = avCrop ? `crop=${avCrop},` : "";

  // Full-screen avatar — HeyGen clip video (looped to durSec to prevent EOF truncation).
  if (beat.layout === "avatar" && beat.avatarClipPath) {
    runFfmpeg([
      "-stream_loop", "-1", "-t", durSec, "-i", beat.avatarClipPath,
      "-filter_complex",
      `[0:v]${avPre}split=2[bgs][fgs];` +
        `[bgs]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=32:2,setsar=1[bg];` +
        `[fgs]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps}[v]`,
      "-map", "[v]", "-t", durSec,
      ...encodeV(fps), outPath,
    ]);
    return;
  }

  // Split: avatar left half + visual right half (both looped and trimmed precisely to durSec).
  if (beat.layout === "split" && beat.avatarClipPath && beat.visualPath) {
    const halfW = Math.round(w / 2);
    runFfmpeg([
      "-stream_loop", "-1", "-t", durSec, "-i", beat.avatarClipPath,
      "-stream_loop", "-1", "-t", durSec, "-i", beat.visualPath,
      "-filter_complex",
      `[0:v]${avPre}scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1,fps=${fps}[l];` +
        `[1:v]scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1,fps=${fps}[r];` +
        `[l][r]hstack=inputs=2[v]`,
      "-map", "[v]", "-t", durSec,
      ...encodeV(fps), outPath,
    ]);
    return;
  }

  // Full-screen B-roll visual clip.
  if (beat.visualPath) {
    runFfmpeg([
      "-stream_loop", "-1", "-t", durSec, "-i", beat.visualPath,
      "-vf", fit, "-t", durSec,
      ...encodeV(fps), outPath,
    ]);
    return;
  }

  // Last resort: a full-screen avatar clip with blur-fill.
  if (beat.avatarClipPath) {
    runFfmpeg([
      "-stream_loop", "-1", "-t", durSec, "-i", beat.avatarClipPath,
      "-filter_complex",
      `[0:v]${avPre}split=2[bgs][fgs];` +
        `[bgs]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=32:2,setsar=1[bg];` +
        `[fgs]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps}[v]`,
      "-map", "[v]", "-t", durSec,
      ...encodeV(fps), outPath,
    ]);
    return;
  }

  throw new Error(`Beat ${beat.index} has neither a visual nor an avatar clip to render`);
}

export async function assembleStudioVideo(
  runId: string,
  voiceoverPath: string,
  beats: RenderBeat[],
  outDir: string,
  resolution?: string
): Promise<string> {
  const beatsDir = path.join(outDir, "beats");
  fs.mkdirSync(beatsDir, { recursive: true });
  const dim = dims(resolution);
  log(runId, "info", `Compositing ${beats.length} silent video beats for continuous voiceover muxing (${dim.w}x${dim.h})`, { stage: "assemble" });

  const clipPaths: string[] = [];
  for (const beat of beats) {
    const clip = path.join(beatsDir, `beat_${String(clipPaths.length).padStart(4, "0")}.mp4`);
    try {
      renderBeat(beat, voiceoverPath, clip, dim);
      clipPaths.push(clip);
    } catch (e) {
      log(runId, "warn", `Beat ${beat.index} (${beat.layout}) render failed: ${(e as Error).message.slice(0, 150)} — skipped`, {
        stage: "assemble",
      });
    }
  }
  if (clipPaths.length === 0) throw new Error("No beats rendered — cannot assemble");

  // Concat the silent beat clips into one continuous visual track.
  const listFile = path.join(beatsDir, "concat.txt");
  fs.writeFileSync(
    listFile,
    clipPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    "utf-8"
  );
  const silentConcat = path.join(beatsDir, "silent_concat.mp4");
  runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-an", "-y", silentConcat]);

  // Mux the continuous, untouched master voiceover directly over the visual track.
  // This eliminates all audio boundary cuts, AAC priming gaps, and HeyGen length desyncs entirely.
  const finalPath = path.join(outDir, "final.mp4");
  runFfmpeg([
    "-i", silentConcat,
    "-i", voiceoverPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    "-shortest",
    "-y",
    finalPath,
  ]);

  log(runId, "success", `Final video: ${finalPath}`, { stage: "assemble" });
  return finalPath;
}
