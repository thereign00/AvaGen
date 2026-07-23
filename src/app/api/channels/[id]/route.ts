import { NextResponse } from "next/server";
import { ensureInit } from "@/lib/init";
import { getChannel, updateChannel, deleteChannel } from "@/lib/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureInit();
  const { id } = await params;
  const cid = Number(id);
  if (!getChannel(cid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    updateChannel(cid, {
      name: String(body.name || ""),
      visual_mode: body.visual_mode as "ai" | "real" | "mix" | undefined,
      ai_style: body.ai_style != null ? String(body.ai_style) : null,
      visual_prompt: body.visual_prompt != null ? String(body.visual_prompt) : null,
      voice_id: body.voice_id != null ? String(body.voice_id) : null,
      interval_sec: body.interval_sec != null ? Number(body.interval_sec) : undefined,
      format: body.format != null ? String(body.format) : undefined,
      avatar_id: body.avatar_id != null ? Number(body.avatar_id) : null,
      ai_provider: body.ai_provider != null ? String(body.ai_provider) : null,
      image_model: body.image_model != null ? String(body.image_model) : null,
      video_model: body.video_model != null ? String(body.video_model) : null,
      images_only: body.images_only ? 1 : 0,
      avatar_iv_max_sec: body.avatar_iv_max_sec != null ? Number(body.avatar_iv_max_sec) : undefined,
    });
    return NextResponse.json(getChannel(cid));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureInit();
  const { id } = await params;
  deleteChannel(Number(id));
  return NextResponse.json({ ok: true });
}
