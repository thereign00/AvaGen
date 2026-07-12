import fs from "node:fs";
import path from "node:path";
import { getAvatar, updateAvatar } from "../avatars";
import { DATA_DIR } from "../run-paths";
import { generateAvatarImage } from "./kie";
import { log } from "../logger";
import { APP_VERSION } from "../version";
import {
  uploadAsset,
  uploadTalkingPhoto,
  heygenPost,
  heygenGet,
} from "./heygen-client";

/**
 * Avatar ingest reuses the run-log store under a synthetic run id so the UI can
 * show a "Diagnostics" panel per avatar (the user otherwise has zero visibility
 * into why an avatar is stuck). Keep this in sync with the avatars logs route.
 */
export function avatarLogId(avatarId: number): string {
  return `avatar-${avatarId}`;
}

/**
 * Avatar ingestion — turns a saved avatar row (status "pending") into a usable
 * HeyGen handle, then marks it "ready". Fire-and-forget from the avatar create
 * route; the UI polls the avatar status.
 *
 * Two engines (docs/DESIGN.md):
 *  - talking_photo (default): upload the reference photo → talking_photo_id.
 *    Fast, no training. The video step uses character.type = "talking_photo".
 *  - photo_avatar_group: upload asset → create group → train → first look's
 *    avatar_id. Slower (training is async) but yields a consistent trained look.
 */

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export async function ingestAvatar(avatarId: number): Promise<void> {
  const avatar = getAvatar(avatarId);
  if (!avatar) throw new Error(`Avatar ${avatarId} not found`);
  const lid = avatarLogId(avatarId);

  log(lid, "info", `Avatar ingest started (v${APP_VERSION}) · engine=${avatar.engine} · source=${avatar.ref_image_path ? "uploaded photo" : "text description"}`, { stage: "avatar" });
  try {
    // No uploaded photo but a text description → generate the reference image
    // via kie.ai nano-banana, then proceed as if it had been uploaded.
    let refPath = avatar.ref_image_path;
    if (!refPath || !fs.existsSync(refPath)) {
      if (avatar.description && avatar.description.trim()) {
        log(lid, "info", "No photo — generating a reference image from the text description (nano-banana)…", { stage: "avatar" });
        const dir = path.join(DATA_DIR, "avatars");
        fs.mkdirSync(dir, { recursive: true });
        const genPath = path.join(dir, `${avatarId}.png`);
        await generateAvatarImage(avatar.description, genPath);
        updateAvatar(avatarId, { ref_image_path: genPath });
        refPath = genPath;
        log(lid, "success", "Reference image generated", { stage: "avatar" });
      } else {
        log(lid, "error", "No reference image and no description to generate one from.", { stage: "avatar" });
        updateAvatar(avatarId, {
          status: "error",
          error: "No reference image and no description to generate one from.",
        });
        return;
      }
    }

    const bytes = fs.readFileSync(refPath);
    const mime = mimeFromPath(refPath);

    if (avatar.engine === "photo_avatar_group") {
      await ingestPhotoAvatarGroup(avatarId, avatar.name, bytes, mime, lid);
    } else {
      await ingestTalkingPhoto(avatarId, bytes, mime, lid);
    }
    log(lid, "success", "Avatar is ready to use.", { stage: "avatar" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(lid, "error", `Avatar ingest failed: ${msg.slice(0, 300)}`, { stage: "avatar" });
    updateAvatar(avatarId, { status: "error", error: msg.slice(0, 500) });
  }
}

async function ingestTalkingPhoto(avatarId: number, bytes: Buffer, mime: string, lid: string): Promise<void> {
  log(lid, "info", `Uploading the photo to HeyGen (Talking Photo, ${(bytes.length / 1024).toFixed(0)} KB)…`, { stage: "avatar" });
  const tp = await uploadTalkingPhoto(bytes, mime);
  log(lid, "info", "HeyGen accepted the photo (talking_photo_id received)", { stage: "avatar" });
  // Talking photos are usable immediately (subject to a short moderation window,
  // which the first video-generation attempt retries through). Also upload the
  // image as a normal asset so we have an image_key for Avatar IV (av4) if asked.
  let imageKey: string | null = null;
  try {
    const asset = await uploadAsset(bytes, mime);
    imageKey = asset.image_key ?? null;
  } catch {
    // image_key is optional — only needed for the Avatar IV (av4) path.
  }
  updateAvatar(avatarId, {
    heygen_id: tp.talking_photo_id,
    image_key: imageKey,
    preview_url: tp.talking_photo_url ?? null,
    status: "ready",
    error: null,
  });
}

interface CreateGroupResp {
  error?: unknown;
  data?: { id?: string; image_url?: string };
}

async function ingestPhotoAvatarGroup(
  avatarId: number,
  name: string,
  bytes: Buffer,
  mime: string,
  lid: string
): Promise<void> {
  log(lid, "info", "Uploading the photo to HeyGen (Photo Avatar Group)…", { stage: "avatar" });
  const asset = await uploadAsset(bytes, mime);
  const imageKey = asset.image_key;
  if (!imageKey) {
    throw new Error(
      "HeyGen did not return an image_key for this upload — required to create a Photo Avatar Group. Try the Talking Photo engine instead."
    );
  }

  const group = await heygenPost<CreateGroupResp>("/v2/photo_avatar/avatar_group/create", {
    name,
    image_key: imageKey,
  });
  const groupId = group.data?.id;
  if (!groupId) {
    throw new Error(`Create Photo Avatar Group returned no id: ${JSON.stringify(group).slice(0, 200)}`);
  }
  updateAvatar(avatarId, { group_id: groupId, image_key: imageKey, status: "training" });

  // Kick off training (async on HeyGen's side).
  log(lid, "info", "Training the avatar look on HeyGen — this can take several minutes…", { stage: "avatar" });
  await heygenPost("/v2/photo_avatar/train", { group_id: groupId });

  // Poll the group's looks until at least one is ready (training can take minutes).
  const lookId = await pollFirstReadyLook(groupId);
  if (!lookId) {
    throw new Error("Photo Avatar Group training did not produce a usable look within 10 minutes. Try again, or use the Talking Photo engine (instant).");
  }
  log(lid, "info", "Training complete — look is ready", { stage: "avatar" });
  updateAvatar(avatarId, { heygen_id: lookId, status: "ready", error: null });
}

/**
 * Poll the group for a usable look id. HeyGen's exact training-status path is
 * version-dependent (see design notes), so we poll the group-details endpoint
 * and take the first look that has an id. Bounded to ~10 minutes.
 */
async function pollFirstReadyLook(groupId: string): Promise<string | null> {
  const DEADLINE = Date.now() + 10 * 60 * 1000;
  let delay = 8000;
  while (Date.now() < DEADLINE) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 4000, 30000);
    try {
      const looks = await heygenGet<{ data?: { avatar_list?: { id?: string }[]; looks?: { id?: string }[] } }>(
        `/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`
      );
      const list = looks.data?.avatar_list ?? looks.data?.looks ?? [];
      const ready = list.find((l) => l.id);
      if (ready?.id) return ready.id;
    } catch {
      // keep polling — the endpoint may 404 until training registers the group
    }
  }
  return null;
}
