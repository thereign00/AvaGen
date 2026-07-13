"use client";
import { useEffect, useState, useCallback } from "react";
import { useT } from "../_i18n";

interface Channel {
  id: number;
  name: string;
  visual_mode: "ai" | "real" | "mix";
  ai_style: string | null;
  visual_prompt: string | null;
  voice_id: string | null;
  interval_sec: number;
  format: string;
  ai_provider: string | null;
  image_model: string | null;
  video_model: string | null;
  images_only: number;
}

const FORMATS = ["1920x1080", "1080x1920", "1280x720", "1080x1080"];

interface Draft {
  name: string;
  visual_mode: "ai" | "real" | "mix";
  ai_style: string;
  visual_prompt: string;
  voice_id: string;
  interval_sec: number;
  format: string;
  ai_provider: string;
  image_model: string;
  video_model: string;
  images_only: boolean;
}

const EMPTY: Draft = { 
  name: "", visual_mode: "mix", ai_style: "cinematic, photo realistic", visual_prompt: "", 
  voice_id: "", interval_sec: 6, format: "1920x1080",
  ai_provider: "", image_model: "", video_model: "", images_only: false
};

export default function ChainesPage() {
  const tr = useT();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const promptPlaceholder = tr(
    "Laissez vide pour le prompt par défaut. Sinon, décrivez quoi montrer à l'écran pour chaque phrase (ex : « Documentaire historique. Pour chaque ligne, donne une requête visuelle de 3-8 mots concrets : lieux, objets, archives réelles… »).",
    "Leave empty for the default. Otherwise, describe what to show on screen for each sentence (e.g. \"Historical documentary. For each line, give a 3-8 word visual query of concrete nouns: places, objects, real archive footage…\")."
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/channels");
      const j = r.ok ? await r.json() : [];
      setChannels(Array.isArray(j) ? j : []);
    } catch {
      setChannels([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function bodyOf(d: Draft) {
    return { 
      name: d.name.trim(), visual_mode: d.visual_mode, ai_style: d.ai_style, 
      visual_prompt: d.visual_prompt, voice_id: d.voice_id, interval_sec: d.interval_sec, 
      format: d.format,
      ai_provider: d.ai_provider, image_model: d.image_model, video_model: d.video_model, images_only: d.images_only
    };
  }

  async function create() {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyOf(draft)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`${tr("Impossible de créer la chaîne", "Couldn't create the channel")} :\n\n${j.error || r.statusText}`); return; }
      setDraft(EMPTY);
      await load();
    } finally { setBusy(false); }
  }

  function startEdit(c: Channel) {
    setEditingId(c.id);
    setEdit({ 
      name: c.name, visual_mode: c.visual_mode, ai_style: c.ai_style ?? "", 
      visual_prompt: c.visual_prompt ?? "", voice_id: c.voice_id ?? "", 
      interval_sec: c.interval_sec, format: c.format,
      ai_provider: c.ai_provider ?? "", image_model: c.image_model ?? "", video_model: c.video_model ?? "",
      images_only: c.images_only === 1
    });
  }

  async function saveEdit() {
    if (editingId == null || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/channels/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyOf(edit)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`${tr("Erreur", "Error")} : ${j.error || r.statusText}`); return; }
      setEditingId(null);
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: number, label: string) {
    if (!confirm(tr(`Supprimer la chaîne « ${label} » ?`, `Delete channel "${label}"?`))) return;
    await fetch(`/api/channels/${id}`, { method: "DELETE" });
    if (editingId === id) setEditingId(null);
    await load();
  }

  const fields = (d: Draft, set: (d: Draft) => void) => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label className="label">{tr("Nom", "Name")}</label>
          <input className="input" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} placeholder={tr("Ma chaîne", "My channel")} />
        </div>
        <div>
          <label className="label">{tr("Mode visuel", "Visual mode")}</label>
          <select className="input" value={d.visual_mode} onChange={(e) => set({ ...d, visual_mode: e.target.value as Draft["visual_mode"] })}>
            <option value="mix">{tr("Mix", "Mix")}</option>
            <option value="real">{tr("Vrai footage", "Real footage")}</option>
            <option value="ai">{tr("Images IA", "AI images")}</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
        <div>
          <label className="label">{tr("Style images IA (animation / rendu)", "AI image style (look / animation)")}</label>
          <input className="input" value={d.ai_style} onChange={(e) => set({ ...d, ai_style: e.target.value })} placeholder="cinematic, photo realistic" />
        </div>
        <div>
          <label className="label">{tr("Intervalle (s)", "Interval (s)")}</label>
          <input className="input" type="number" min={1.5} max={15} step={0.5} value={d.interval_sec}
            onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n)) set({ ...d, interval_sec: n }); }} />
        </div>
        <div>
          <label className="label">{tr("Format", "Format")}</label>
          <select className="input" value={d.format} onChange={(e) => set({ ...d, format: e.target.value })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">{tr("ElevenLabs voice_id (optionnel — voix de cette chaîne)", "ElevenLabs voice_id (optional — this channel's voice)")}</label>
        <input className="input" value={d.voice_id} onChange={(e) => set({ ...d, voice_id: e.target.value })}
          placeholder={tr("vide = voix globale (Paramètres)", "empty = global voice (Settings)")} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div>
          <label className="label">{tr("Fournisseur IA (optionnel)", "AI Provider (optional)")}</label>
          <select className="input" value={d.ai_provider} onChange={(e) => set({ ...d, ai_provider: e.target.value })}>
            <option value="">{tr("Par défaut (Paramètres)", "Default (Settings)")}</option>
            <option value="69labs">69labs</option>
            <option value="kie">Kie AI</option>
          </select>
        </div>
        <div>
          <label className="label">{tr("Modèle Image (optionnel)", "Image Model (optional)")}</label>
          <input className="input" value={d.image_model} onChange={(e) => set({ ...d, image_model: e.target.value })} placeholder={tr("Par défaut", "Default")} />
        </div>
        <div>
          <label className="label">{tr("Modèle Vidéo (optionnel)", "Video Model (optional)")}</label>
          <input className="input" value={d.video_model} onChange={(e) => set({ ...d, video_model: e.target.value })} placeholder={tr("Par défaut", "Default")} />
        </div>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
          <input type="checkbox" checked={d.images_only} onChange={(e) => set({ ...d, images_only: e.target.checked })} />
          <span>{tr("Images uniquement (désactiver la génération vidéo et animer les images fixes avec Ken Burns)", "Images only (turn off video generation and animate stills with Ken Burns)")}</span>
        </label>
      </div>

      <div>
        <label className="label">{tr("Prompt visuel (découpage / choix des images) — optionnel", "Visual prompt (what to show per beat) — optional")}</label>
        <textarea className="input" rows={5} value={d.visual_prompt} onChange={(e) => set({ ...d, visual_prompt: e.target.value })}
          placeholder={promptPlaceholder} style={{ resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
        <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
          {tr(
            "Guide ce qui est cherché/montré pour chaque phrase de la narration. Vide = prompt par défaut.",
            "Guides what is searched/shown for each sentence of the narration. Empty = default prompt."
          )}
        </div>
      </div>
    </>
  );

  return (
    <div>
      <h1>{tr("Chaînes", "Channels")}</h1>
      <p className="muted" style={{ marginBottom: 18, fontSize: 14 }}>
        {tr(
          "Une chaîne = des réglages par défaut (mode visuel, style, prompt visuel, intervalle, format).",
          "A channel = a set of defaults (visual mode, style, visual prompt, interval, format)."
        )}
      </p>

      <div className="card" style={{ display: "grid", gap: 16, marginBottom: 22 }}>
        {fields(draft, setDraft)}
        <div>
          <button className="btn" onClick={create} disabled={busy || !draft.name.trim()}>
            {busy ? tr("Création…", "Creating…") : tr("Créer la chaîne", "Create channel")}
          </button>
        </div>
      </div>

      {channels.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {channels.map((c) => (
            <div key={c.id} className="card" style={{ padding: editingId === c.id ? 16 : "12px 16px", display: "grid", gap: editingId === c.id ? 16 : 0 }}>
              {editingId === c.id ? (
                <>
                  {fields(edit, setEdit)}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={saveEdit} disabled={busy}>{tr("Enregistrer", "Save")}</button>
                    <button className="btn btn-ghost" onClick={() => setEditingId(null)}>{tr("Annuler", "Cancel")}</button>
                    <button className="btn btn-ghost" style={{ marginLeft: "auto", color: "#b91c1c" }} onClick={() => remove(c.id, c.name)}>{tr("Supprimer", "Delete")}</button>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontSize: 13.5, minWidth: 0 }}>
                    <strong>{c.name}</strong>
                    <span className="faint"> — {c.visual_mode}, {c.format}, {c.interval_sec}s{c.ai_style ? `, ${c.ai_style}` : ""}{c.visual_prompt ? tr(" · prompt ✓", " · prompt ✓") : ""}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => startEdit(c)}>{tr("Modifier", "Edit")}</button>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", color: "#b91c1c" }} onClick={() => remove(c.id, c.name)}>{tr("Supprimer", "Delete")}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
