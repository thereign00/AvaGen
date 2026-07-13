import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import db from "./db";
import { log } from "./logger";
import { getSetting } from "./settings";
import { getRunDir } from "./run-paths";
import { pLimit } from "./plimit";
import { checkCancelled, clearCancelled, CancelledError } from "./cancellation";
import { APP_VERSION } from "./version";
import { synthesizeVoiceover } from "./services/elevenlabs-voiceover";
import { planBeats, type Beat } from "./services/studio-plan";
import { acquireVisual } from "./services/visual-source";
import { generateAvatarClip, type AvatarHandle } from "./services/heygen-video";
import { assembleStudioVideo, sliceAudio, type RenderBeat } from "./services/studio-assemble";

/**
 * AVATAR DOCUMENTARY pipeline.
 *
 *   script → ElevenLabs voiceover (+ word timings) → beats → per beat:
 *     real/AI b-roll (Ken Burns on stills) + a HeyGen avatar clip on avatar
 *     beats → composite over the one voiceover → final.mp4.
 *
 * See docs/DESIGN.md for the full design and confirmed API shapes.
 */

const updateRun = db.prepare(
  "UPDATE runs SET status = ?, output_path = ?, updated_at = datetime('now') WHERE id = ?"
);
const getConfigStmt = db.prepare("SELECT config_json FROM runs WHERE id = ?");
const getAvatarSnapStmt = db.prepare(
  "SELECT avatar_db_id, avatar_engine, avatar_heygen_id, avatar_image_key, avatar_use_iv, avatar_motion_prompt FROM runs WHERE id = ?"
);
const getVoiceSnapStmt = db.prepare("SELECT preset_voice_id FROM runs WHERE id = ?");

interface StudioConfig {
  visualMode: "ai" | "real" | "mix";
  secondsPerVisual: number;
  avatarPercent: number;
  realPercent: number;
  aiStyle: string | undefined;
  format: string | undefined;
  visualPrompt: string | undefined;
  aiProvider: string | undefined;
  imageModel: string | undefined;
  videoModel: string | undefined;
  imagesOnly: boolean;
}

function readConfig(runId: string): StudioConfig {
  const row = getConfigStmt.get(runId) as { config_json: string | null } | undefined;
  let cfg: Partial<StudioConfig> & { mode?: string } = {};
  try {
    cfg = row?.config_json ? JSON.parse(row.config_json) : {};
  } catch {}
  const visualMode = (cfg.visualMode as StudioConfig["visualMode"]) || "mix";
  const realFromMode = visualMode === "ai" ? 0 : visualMode === "real" ? 100 : undefined;
  return {
    visualMode,
    secondsPerVisual: Number(cfg.secondsPerVisual) || Number(getSetting("SECONDS_PER_VISUAL") || "4.5"),
    avatarPercent: cfg.avatarPercent != null ? Number(cfg.avatarPercent) : Number(getSetting("AVATAR_FREQUENCY_PERCENT") || "15"),
    realPercent: realFromMode ?? (cfg.realPercent != null ? Number(cfg.realPercent) : Number(getSetting("REAL_RATIO_PERCENT") || "80")),
    aiStyle: typeof cfg.aiStyle === "string" && cfg.aiStyle.trim() ? cfg.aiStyle.trim() : undefined,
    format: typeof cfg.format === "string" && /^\d+\s*[x×]\s*\d+$/i.test(cfg.format) ? cfg.format.trim() : undefined,
    visualPrompt: typeof cfg.visualPrompt === "string" && cfg.visualPrompt.trim() ? cfg.visualPrompt.trim() : undefined,
    aiProvider: typeof cfg.aiProvider === "string" && cfg.aiProvider.trim() ? cfg.aiProvider.trim() : undefined,
    imageModel: typeof cfg.imageModel === "string" && cfg.imageModel.trim() ? cfg.imageModel.trim() : undefined,
    videoModel: typeof cfg.videoModel === "string" && cfg.videoModel.trim() ? cfg.videoModel.trim() : undefined,
    imagesOnly: cfg.imagesOnly === true,
  };
}

function readAvatar(runId: string): (AvatarHandle & { dbId: number }) | null {
  const row = getAvatarSnapStmt.get(runId) as
    | {
        avatar_db_id: number | null;
        avatar_engine: string | null;
        avatar_heygen_id: string | null;
        avatar_image_key: string | null;
        avatar_use_iv: string | null;
        avatar_motion_prompt: string | null;
      }
    | undefined;
  if (!row?.avatar_db_id || !row.avatar_heygen_id) return null;
  return {
    dbId: row.avatar_db_id,
    engine: row.avatar_engine === "photo_avatar_group" ? "photo_avatar_group" : "talking_photo",
    heygenId: row.avatar_heygen_id,
    imageKey: row.avatar_image_key,
    useAvatarIv: row.avatar_use_iv === "1",
    motionPrompt: row.avatar_motion_prompt,
  };
}

export async function runStudioPipeline(runId: string, script: string): Promise<void> {
  const runDir = getRunDir(runId);
  const audioDir = path.join(runDir, "audio");
  const brollDir = path.join(runDir, "broll");
  const avatarDir = path.join(runDir, "avatar");
  for (const d of [runDir, audioDir, brollDir, avatarDir]) fs.mkdirSync(d, { recursive: true });

  try {
    clearCancelled(runId);
    updateRun.run("running", null, runId);
    const cfg = readConfig(runId);
    const avatar = readAvatar(runId);
    log(
      runId,
      "info",
      `Pipeline started (v${APP_VERSION}) · mode=${cfg.visualMode} · ${cfg.secondsPerVisual}s/visual · avatar=${avatar ? `${cfg.avatarPercent}%` : "none"} · real=${cfg.realPercent}%`,
      { stage: "pipeline" }
    );

    if (!script.trim()) throw new Error("Script is empty — paste a script on the New Video page.");

    // 1. ElevenLabs voiceover (+ word timings).
    const voiceRow = getVoiceSnapStmt.get(runId) as { preset_voice_id: string | null } | undefined;
    const voiceover = await synthesizeVoiceover(runId, script, audioDir, {
      voiceOverride: voiceRow?.preset_voice_id ?? null,
    });
    fs.writeFileSync(path.join(runDir, "words.json"), JSON.stringify(voiceover.words, null, 2), "utf-8");
    checkCancelled(runId);
    if (voiceover.words.length === 0) {
      throw new Error("ElevenLabs returned no word timings — cannot place visuals. Check the API key / model.");
    }

    // 2. Plan beats.
    const beats = await planBeats(voiceover.words, {
      secondsPerVisual: cfg.secondsPerVisual,
      avatarPercent: cfg.avatarPercent,
      realPercent: cfg.realPercent,
      hasAvatar: !!avatar,
      runId,
      visualPrompt: cfg.visualPrompt,
    });
    if (beats.length === 0) throw new Error("No beats produced from the voiceover.");

    // Clamp coverage to the whole audio: first beat starts at 0, last ends at audio end.
    const durMs = Math.round(voiceover.durationSec * 1000);
    beats[0].startMs = 0;
    beats[beats.length - 1].endMs = Math.max(beats[beats.length - 1].endMs, durMs);
    fs.writeFileSync(path.join(runDir, "beats.json"), JSON.stringify(beats, null, 2), "utf-8");

    // 3. Fetch visuals + generate avatar clips per beat (concurrency-limited).
    const visualConc = Math.max(1, Number(getSetting("VISUAL_CONCURRENCY") || "3"));
    const avatarConc = Math.max(1, Number(getSetting("AVATAR_CONCURRENCY") || "2"));
    const limitVisual = pLimit(visualConc);
    const limitAvatar = pLimit(avatarConc);
    const usedIds = new Set<string>();

    const renderBeats: RenderBeat[] = await Promise.all(
      beats.map(async (beat): Promise<RenderBeat> => {
        let visualPath: string | null = null;
        let avatarClipPath: string | null = null;

        // B-roll for broll/split beats.
        if (beat.layout !== "avatar") {
          try {
            const out = path.join(brollDir, `beat_${String(beat.index).padStart(4, "0")}.mp4`);
            const res = await limitVisual(() => acquireVisual(runId, beat, out, usedIds, { aiStyle: cfg.aiStyle, resolution: cfg.format }));
            visualPath = res.path;
          } catch (e) {
            log(runId, "warn", `Beat ${beat.index} visual failed (${(e as Error).message.slice(0, 120)}) — will reuse a neighbour`, {
              stage: "visual",
            });
            visualPath = null; // filled from the nearest good visual after all beats resolve
          }
        }

        // Avatar clip for avatar/split beats.
        if (avatar && (beat.layout === "avatar" || beat.layout === "split")) {
          try {
            const beatAudio = path.join(avatarDir, `beat_${String(beat.index).padStart(4, "0")}.mp3`);
            sliceAudio(voiceover.filePath, beat.startMs, beat.endMs, beatAudio);
            const clip = path.join(avatarDir, `beat_${String(beat.index).padStart(4, "0")}.mp4`);
            await limitAvatar(() =>
              generateAvatarClip(runId, avatar, beatAudio, clip, { title: `beat ${beat.index}`, resolution: cfg.format })
            );
            avatarClipPath = clip;
          } catch (e) {
            log(runId, "warn", `Beat ${beat.index} avatar failed (${(e as Error).message.slice(0, 140)}) — using b-roll for it`, {
              stage: "avatar_video",
            });
            // Degrade to b-roll: if there's no visual yet (was a full avatar beat), fetch one.
            if (!visualPath) {
              try {
                const out = path.join(brollDir, `beat_${String(beat.index).padStart(4, "0")}.mp4`);
                const res = await limitVisual(() => acquireVisual(runId, { ...beat, source: beat.source }, out, usedIds, { 
                  aiStyle: cfg.aiStyle, 
                  resolution: cfg.format,
                  aiProvider: cfg.aiProvider,
                  imageModel: cfg.imageModel,
                  videoModel: cfg.videoModel,
                  imagesOnly: cfg.imagesOnly,
                }));
                visualPath = res.path;
              } catch {
                visualPath = null; // filled from the nearest good visual after all beats resolve
              }
            }
            beat.layout = "broll";
          }
        }

        return { ...beat, visualPath, avatarClipPath };
      })
    );
    checkCancelled(runId);

    // 3b. No black screens: any non-avatar beat whose visual failed reuses the
    // NEAREST beat that has a visual (carry-over) instead of a dark placeholder.
    const goodIdx = renderBeats.map((b, i) => (b.visualPath ? i : -1)).filter((i) => i >= 0);
    let reused = 0;
    for (let i = 0; i < renderBeats.length; i++) {
      const b = renderBeats[i];
      if (b.layout === "avatar" || b.visualPath) continue; // avatar-only beats need no visual
      let best: string | null = null;
      let bestDist = Infinity;
      for (const gi of goodIdx) {
        const d = Math.abs(gi - i);
        if (d < bestDist) {
          bestDist = d;
          best = renderBeats[gi].visualPath;
        }
      }
      b.visualPath = best ?? placeholder(brollDir, b, cfg.format); // placeholder only if nothing else exists
      if (best) reused++;
    }
    if (reused > 0) {
      log(runId, "info", `${reused} beat(s) reused a neighbouring visual (no black screens)`, { stage: "visual" });
    }

    // 4. Composite over the master voiceover.
    const finalPath = await assembleStudioVideo(runId, voiceover.filePath, renderBeats, runDir, cfg.format);
    updateRun.run("done", finalPath, runId);
    log(runId, "success", "Pipeline complete", { stage: "pipeline", data: { finalPath } });
  } catch (e) {
    if (e instanceof CancelledError) {
      log(runId, "warn", "Pipeline cancelled by user", { stage: "pipeline" });
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      log(runId, "error", `Pipeline crashed: ${msg}`, { stage: "pipeline" });
      updateRun.run("error", null, runId);
    }
  }
}

/** Solid-color filler clip so a failed beat still holds its slot in the timeline. */
function placeholder(dir: string, beat: Beat, resolution?: string): string {
  const out = path.join(dir, `ph_${String(beat.index).padStart(4, "0")}.mp4`);
  const res = resolution || getSetting("VIDEO_RESOLUTION") || "1920x1080";
  const fps = Math.max(1, Number(getSetting("VIDEO_FPS") || "30"));
  const dur = Math.max(0.3, (beat.endMs - beat.startMs) / 1000).toFixed(3);
  const color = getSetting("AVATAR_BACKGROUND") || "#101418";
  const ff = getSetting("FFMPEG_PATH") || "ffmpeg";
  const r = spawnSync(
    ff,
    [
      "-f", "lavfi",
      "-i", `color=c=${color}:s=${res.replace("×", "x")}:r=${fps}:d=${dur}`,
      "-t", dur,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an",
      "-movflags", "+faststart", "-y", out,
    ],
    { stdio: "pipe" }
  );
  if (r.status !== 0) throw new Error(`placeholder clip failed: ${r.stderr?.toString().slice(-200)}`);
  return out;
}
