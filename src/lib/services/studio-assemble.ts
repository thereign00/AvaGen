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

/** Video + audio encode params (identical across beats → concat with -c copy). */
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
 * Render one beat clip (WITH audio) to outPath.
 *  - avatar/split: use the HeyGen clip's OWN audio so the lips match perfectly
 *    (HeyGen may add a short lead-in; its own audio carries the same offset, so
 *    overlaying the master track separately would drift). Length = the clip.
 *  - broll: full-screen visual + the master voiceover slice [startMs,endMs].
 * Every beat carries an aac track → concatenated audio = the full narration.
 */
function renderBeat(
  beat: RenderBeat,
  voiceoverPath: string,
  outPath: string,
  dim: { w: number; h: number; fps: number }
): void {
  const { w, h, fps } = dim;
  const startSec = (beat.startMs / 1000).toFixed(3);
  const durSec = Math.max(0.2, (beat.endMs - beat.startMs) / 1000).toFixed(3);
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps}`;

  // Strip HeyGen's pillarbox bars from the avatar clip so it fills the frame.
  const avCrop = beat.avatarClipPath ? contentCrop(beat.avatarClipPath) : null;
  const avPre = avCrop ? `crop=${avCrop},` : "";

  // Full-screen avatar — HeyGen clip video + its own lip-synced audio.
  // Blur-fill: a portrait talking-photo can never fill 16:9, and zoom-cropping
  // it would cut the head. Background = the same clip scaled to fill + blurred,
  // foreground = the clip fitted by height, centered. For an already-16:9 clip
  // the foreground covers the frame exactly, so this is a no-op visually.
  if (beat.layout === "avatar" && beat.avatarClipPath) {
    runFfmpeg([
      "-i", beat.avatarClipPath,
      "-filter_complex",
      `[0:v]${avPre}split=2[bgs][fgs];` +
        `[bgs]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=32:2,setsar=1[bg];` +
        `[fgs]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps}[v]`,
      "-map", "[v]", "-map", "0:a:0",
      ...encodeAV(fps), outPath,
    ]);
    return;
  }

  // Split: avatar left half (drives length + audio) + visual right half.
  if (beat.layout === "split" && beat.avatarClipPath && beat.visualPath) {
    const halfW = Math.round(w / 2);
    runFfmpeg([
      "-i", beat.avatarClipPath,
      "-stream_loop", "-1", "-i", beat.visualPath,
      "-filter_complex",
      `[0:v]${avPre}scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1,fps=${fps}[l];` +
        `[1:v]scale=${halfW}:${h}:force_original_aspect_ratio=increase,crop=${halfW}:${h},setsar=1,fps=${fps}[r];` +
        `[l][r]hstack=inputs=2[v]`,
      "-map", "[v]", "-map", "0:a:0", "-shortest",
      ...encodeAV(fps), outPath,
    ]);
    return;
  }

  // Full-screen B-roll + the master voiceover slice for this beat.
  if (beat.visualPath) {
    runFfmpeg([
      "-stream_loop", "-1", "-t", durSec, "-i", beat.visualPath,
      "-ss", startSec, "-t", durSec, "-i", voiceoverPath,
      "-vf", fit, "-map", "0:v:0", "-map", "1:a:0", "-t", durSec,
      ...encodeAV(fps), outPath,
    ]);
    return;
  }

  // Last resort: a full-screen avatar clip with its own audio (blur-fill).
  if (beat.avatarClipPath) {
    runFfmpeg([
      "-i", beat.avatarClipPath,
      "-filter_complex",
      `[0:v]${avPre}split=2[bgs][fgs];` +
        `[bgs]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=32:2,setsar=1[bg];` +
        `[fgs]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps}[v]`,
      "-map", "[v]", "-map", "0:a:0",
      ...encodeAV(fps), outPath,
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
  log(runId, "info", `Compositing ${beats.length} beats over the voiceover (${dim.w}x${dim.h})`, { stage: "assemble" });

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

  // Concat the beats (each already carries its own aac audio → identical params,
  // safe stream copy). The concatenated audio is the full narration in order.
  const listFile = path.join(beatsDir, "concat.txt");
  fs.writeFileSync(
    listFile,
    clipPaths.map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    "utf-8"
  );
  const finalPath = path.join(outDir, "final.mp4");
  runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", "-y", finalPath]);

  log(runId, "success", `Final video: ${finalPath}`, { stage: "assemble" });
  return finalPath;
}
