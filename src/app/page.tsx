"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "./_i18n";

interface AvatarLite {
  id: number;
  name: string;
  status: "pending" | "training" | "ready" | "error";
  channel_id: number | null;
}
interface Channel {
  id: number;
  name: string;
  visual_mode: "ai" | "real" | "mix";
  ai_style: string | null;
  visual_prompt: string | null;
  interval_sec: number;
  format: string;
  avatar_id: number | null;
}
type VisualMode = "ai" | "real" | "mix";

export default function CreerVideoPage() {
  const router = useRouter();
  const tr = useT();
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [avatars, setAvatars] = useState<AvatarLite[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [avatarId, setAvatarId] = useState<number | null>(null);
  const [visualMode, setVisualMode] = useState<VisualMode>("mix");
  const [realPercent, setRealPercent] = useState(80);
  const [secondsPerVisual, setSecondsPerVisual] = useState(4.5);
  const [avatarPercent, setAvatarPercent] = useState(15);
  const [visualPrompt, setVisualPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/avatars")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AvatarLite[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setAvatars(list);
        const firstReady = list.find((a) => a.status === "ready");
        if (firstReady) setAvatarId(firstReady.id);
      })
      .catch(() => {});
    fetch("/api/channels")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Channel[]) => setChannels(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  function applyChannel(id: number | null) {
    setChannelId(id);
    const ch = channels.find((c) => c.id === id);
    if (!ch) return;
    setVisualMode(ch.visual_mode);
    setSecondsPerVisual(ch.interval_sec);
    setVisualPrompt(ch.visual_prompt ?? "");
    if (ch.avatar_id) setAvatarId(ch.avatar_id);
  }

  const readyAvatars = avatars.filter((a) => a.status === "ready");
  const preparing = avatars.filter((a) => a.status === "pending" || a.status === "training");
  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;

  async function start() {
    if (!script.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          script,
          avatarId,
          channelId,
          visualMode,
          realPercent: visualMode === "mix" ? realPercent : undefined,
          secondsPerVisual,
          avatarPercent,
          // Empty → undefined so the channel's saved prompt (or the default)
          // still applies; a typed prompt overrides the channel for this run.
          visualPrompt: visualPrompt.trim() || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(`${tr("Impossible de démarrer la vidéo", "Couldn't start the video")} :\n\n${j.error || r.statusText}`);
        return;
      }
      router.push(`/runs/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  const seg = (mode: VisualMode, label: string, desc: string) => (
    <button key={mode} type="button" onClick={() => setVisualMode(mode)} className="card"
      style={{ textAlign: "left", padding: "12px 14px", cursor: "pointer",
        borderColor: visualMode === mode ? "var(--accent)" : "var(--border)",
        background: visualMode === mode ? "var(--surface-2)" : "var(--surface)" }}>
      <div style={{ fontWeight: 650, fontSize: 13.5, marginBottom: 2 }}>{label}</div>
      <div className="faint" style={{ fontSize: 12, lineHeight: 1.4 }}>{desc}</div>
    </button>
  );

  return (
    <div>
      <h1>{tr("Créer une vidéo", "Create a video")}</h1>
      <p className="muted" style={{ marginBottom: 18, fontSize: 14, lineHeight: 1.6 }}>
        {tr(
          "Collez un script, choisissez un avatar récurrent et la source des visuels — ElevenLabs narre, HeyGen anime l'avatar, et le reste est illustré par du vrai footage ou des images IA.",
          "Paste a script, pick a recurring avatar and the visual source — ElevenLabs narrates, HeyGen animates the avatar, and the rest is illustrated with real footage or AI images."
        )}
      </p>

      <div className="card" style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label className="label">{tr("Titre (optionnel)", "Title (optional)")}</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("ex : Le secret amish oublié", "e.g. The forgotten Amish secret")} />
          </div>
          <div>
            <label className="label">{tr("Chaîne", "Channel")}</label>
            <select className="input" value={channelId ?? ""} onChange={(e) => applyChannel(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">{tr("Aucune — réglages manuels", "None — manual settings")}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">{tr("Script", "Script")}</label>
          <textarea className="input" value={script} onChange={(e) => setScript(e.target.value)}
            placeholder={tr("Collez ici le script complet de la narration…", "Paste the full narration script here…")} rows={9}
            style={{ resize: "vertical", lineHeight: 1.55, fontFamily: "inherit" }} />
          <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
            {wordCount} {tr("mots", "words")} · ≈ {Math.max(1, Math.round(wordCount / 150))} {tr("min de narration", "min of narration")}
          </div>
        </div>

        <div>
          <label className="label">{tr("Avatar", "Avatar")}</label>
          <select className="input" value={avatarId ?? ""} onChange={(e) => setAvatarId(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">{tr("Aucun — sans visage (b-roll uniquement)", "None — faceless (b-roll only)")}</option>
            {readyAvatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
            {preparing.length > 0 && `${preparing.length} ${tr("avatar(s) en préparation", "avatar(s) preparing")} · `}
            <Link href="/avatars">{tr("Créer ou gérer les avatars →", "Create or manage avatars →")}</Link>
          </div>
        </div>

        <div>
          <label className="label">{tr("Mode visuel", "Visual mode")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {seg("ai", tr("Images IA", "AI images"), tr("B-roll généré (nano-banana / Veo)", "Generated b-roll (nano-banana / Veo)"))}
            {seg("real", tr("Vrai footage", "Real footage"), tr("Vidéos & images réelles d'internet", "Real videos & images from the internet"))}
            {seg("mix", tr("Mix", "Mix"), tr("Mélange réel + IA", "Blend real + AI"))}
          </div>
        </div>

        {visualMode === "mix" && (
          <div>
            <label className="label">
              {tr("Équilibre réel / IA", "Real / AI balance")} — {realPercent}% {tr("réel", "real")} / {100 - realPercent}% {tr("IA", "AI")}
            </label>
            <input type="range" min={0} max={100} step={5} value={realPercent} onChange={(e) => setRealPercent(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
        )}

        <div>
          <label className="label">{tr("Prompt visuel (optionnel — guide le choix des images)", "Visual prompt (optional — guides what is shown)")}</label>
          <textarea className="input" rows={4} value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)}
            placeholder={tr(
              "Vide = prompt de la chaîne (ou défaut). Décrivez le style documentaire, les lieux, quoi montrer/éviter pour chaque phrase…",
              "Empty = the channel's prompt (or the default). Describe the documentary style, locations, what to show/avoid for each sentence…"
            )}
            style={{ resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
            {tr(
              "C'est le « prompt de découpage » : pour chaque phrase de la narration, Gemini écrit la requête (Pexels…) ou le prompt IA à partir de ces consignes.",
              "This is the \"split prompt\": for each sentence of the narration, Gemini writes the search query (Pexels…) or the AI prompt from this guidance."
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label className="label">{tr("Intervalle par visuel (s)", "Seconds per visual")}</label>
            <input className="input" type="number" min={1.5} max={15} step={0.5} value={secondsPerVisual}
              onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) setSecondsPerVisual(n); }} />
          </div>
          <div>
            <label className="label">{tr("Avatar à l'écran", "Avatar on screen")} — {avatarPercent}% {tr("des plans", "of beats")}</label>
            <input type="range" min={0} max={60} step={5} value={avatarPercent} disabled={avatarId == null}
              onChange={(e) => setAvatarPercent(Number(e.target.value))} style={{ width: "100%", opacity: avatarId == null ? 0.4 : 1 }} />
            <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
              {avatarId == null ? tr("Choisissez un avatar pour activer.", "Pick an avatar to enable.") : tr("Fréquence d'apparition de l'avatar.", "How often the avatar appears.")}
            </div>
          </div>
        </div>

        <div>
          <button className="btn" onClick={start} disabled={busy || !script.trim()}>
            {busy ? tr("Démarrage…", "Starting…") : tr("Créer la vidéo", "Create the video")}
          </button>
        </div>
      </div>
    </div>
  );
}
