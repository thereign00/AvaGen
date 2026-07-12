import { NextResponse } from "next/server";
import fs from "node:fs";
import { ensureInit } from "@/lib/init";
import { getAvatar, deleteAvatar } from "@/lib/avatars";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureInit();
  const { id } = await params;
  const avatar = getAvatar(Number(id));
  if (!avatar) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(avatar);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureInit();
  const { id } = await params;
  const avatar = getAvatar(Number(id));
  if (!avatar) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Best-effort cleanup of the local reference image.
  if (avatar.ref_image_path && fs.existsSync(avatar.ref_image_path)) {
    try {
      fs.unlinkSync(avatar.ref_image_path);
    } catch {}
  }
  deleteAvatar(avatar.id);
  return NextResponse.json({ ok: true });
}
