import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { ensureInit } from "@/lib/init";
import { runStudioPipeline } from "@/lib/studio-pipeline";
import { sanitizeFolderName, pickAvailableFolderName } from "@/lib/run-paths";
import { getPromptPreset } from "@/lib/prompts";
import { getAvatar } from "@/lib/avatars";
import { getChannel } from "@/lib/channels";

export const runtime = "nodejs";

const insertRun = db.prepare(
  "INSERT INTO runs (id, title, folder_name, status, script, config_json) VALUES (?, ?, ?, 'pending', ?, ?)"
);
const setPresetSnapshot = db.prepare(
  "UPDATE runs SET preset_id = ?, preset_name = ?, preset_content = ?, preset_animation_motion = ?, preset_image_prompt = ?, preset_voice_id = ? WHERE id = ?"
);
const setVoiceSnapshot = db.prepare("UPDATE runs SET preset_voice_id = ? WHERE id = ?");
const setAvatarSnapshot = db.prepare(
  "UPDATE runs SET avatar_db_id = ?, avatar_engine = ?, avatar_heygen_id = ?, avatar_image_key = ?, avatar_use_iv = ?, avatar_motion_prompt = ? WHERE id = ?"
);

interface Body {
  script?: string;
  title?: string;
  avatarId?: number | null;
  channelId?: number | null;
  presetId?: number | null;
  visualMode?: "ai" | "real" | "mix";
  secondsPerVisual?: number;
  avatarPercent?: number;
  realPercent?: number;
  aiStyle?: string;
  visualPrompt?: string;
}

export async function POST(req: Request) {
  ensureInit();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const script = (body.script || "").trim();
  if (!script) return NextResponse.json({ error: "Script is required." }, { status: 400 });

  // Channel supplies defaults (mode / interval / style / default avatar) that the
  // explicit body overrides.
  const channel = body.channelId ? getChannel(Number(body.channelId)) : null;

  // Resolve the avatar (explicit pick, else the channel's default). An explicit
  // pick that isn't ready is a hard error; a stale channel-default just degrades
  // to a faceless run rather than blocking every video on that channel.
  const explicit = body.avatarId != null;
  const avatarId = body.avatarId ?? channel?.avatar_id ?? null;
  let avatar = null;
  if (avatarId) {
    const found = getAvatar(Number(avatarId));
    const ready = found && found.status === "ready" && found.heygen_id;
    if (!ready) {
      if (explicit) {
        const reason = !found ? "introuvable" : `pas encore prêt (statut : ${found.status})`;
        return NextResponse.json(
          { error: `L'avatar sélectionné est ${reason}. Attendez qu'il soit prêt.` },
          { status: 409 }
        );
      }
      // Channel default is missing/not-ready → continue without an avatar.
      avatar = null;
    } else {
      avatar = found;
    }
  }

  const id = randomUUID();
  const baseFolder = sanitizeFolderName(body.title ?? "", id.slice(0, 8));
  const folderName = pickAvailableFolderName(baseFolder);

  const config = {
    mode: "studio",
    visualMode: body.visualMode ?? channel?.visual_mode ?? "mix",
    secondsPerVisual: body.secondsPerVisual ?? channel?.interval_sec,
    avatarPercent: body.avatarPercent,
    realPercent: body.realPercent,
    aiStyle: body.aiStyle ?? channel?.ai_style ?? undefined,
    visualPrompt: body.visualPrompt ?? channel?.visual_prompt ?? undefined,
    format: channel?.format,
    channelId: channel?.id,
    aiProvider: channel?.ai_provider,
    imageModel: channel?.image_model,
    videoModel: channel?.video_model,
    imagesOnly: channel?.images_only === 1,
  };

  insertRun.run(id, body.title?.trim() || null, folderName, script, JSON.stringify(config));

  if (body.presetId) {
    const preset = getPromptPreset(Number(body.presetId));
    if (preset) {
      setPresetSnapshot.run(
        preset.id,
        preset.name,
        preset.content,
        preset.animation_motion,
        preset.image_prompt,
        preset.heygen_voice_id,
        id
      );
    }
  }

  if (avatar) {
    setAvatarSnapshot.run(
      avatar.id,
      avatar.engine,
      avatar.heygen_id,
      avatar.image_key,
      avatar.use_avatar_iv,
      avatar.motion_prompt,
      id
    );
  }

  // Per-channel ElevenLabs narration voice — snapshotted onto the run; the
  // pipeline reads preset_voice_id as the voiceOverride for the voiceover.
  if (channel?.voice_id) {
    setVoiceSnapshot.run(channel.voice_id, id);
  }

  runStudioPipeline(id, script).catch((e) => {
    // eslint-disable-next-line no-console
    console.error("studio pipeline crash", e);
  });

  return NextResponse.json({ id, folderName });
}
