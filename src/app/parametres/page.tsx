"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useT } from "../_i18n";

type Settings = Record<string, string>;
interface Voice { voice_id: string; name: string }

export default function ParametresPage() {
  const tr = useT();
  const [s, setS] = useState<Settings>({});
  const [dirty, setDirty] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [elVoices, setElVoices] = useState<Voice[] | null>(null);
  const [hgVoices, setHgVoices] = useState<Voice[] | null>(null);
  const [loadingVoices, setLoadingVoices] = useState<"el" | "hg" | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j === "object" && !Array.isArray(j) && !("error" in j)) setS(j as Settings);
    } catch {
      /* keep current values */
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const val = (k: string) => (k in dirty ? dirty[k] : s[k] ?? "");
  const set = (k: string, v: string) => setDirty((d) => ({ ...d, [k]: v }));

  // Real-footage sources: enable/disable + priority (order). Stored as the
  // FOOTAGE_SOURCES CSV the pipeline reads (first = tried first).
  const ALL_FOOTAGE = [
    { id: "pexels", label: "Pexels" },
    { id: "pixabay", label: "Pixabay" },
    { id: "openverse", label: "Openverse" },
    { id: "wikimedia", label: "Wikimedia" },
  ];
  const footageList = (): string[] => {
    const raw = val("FOOTAGE_SOURCES") || "pexels,pixabay,openverse,wikimedia";
    const list = raw
      .split(/[,\n;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => ALL_FOOTAGE.some((f) => f.id === x));
    return list.length ? Array.from(new Set(list)) : ALL_FOOTAGE.map((f) => f.id);
  };
  const writeFootage = (list: string[]) => set("FOOTAGE_SOURCES", list.join(","));
  const toggleFootage = (id: string) => {
    const list = footageList();
    if (list.includes(id)) {
      const next = list.filter((x) => x !== id);
      if (next.length > 0) writeFootage(next); // never disable all
    } else {
      writeFootage([...list, id]);
    }
  };
  const setFootagePriority = (id: string) => writeFootage([id, ...footageList().filter((x) => x !== id)]);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dirty) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`${tr("Erreur", "Error")} : ${j.error || r.statusText}`); return; }
      setDirty({});
      await load();
      setSavedAt(new Date().toLocaleTimeString());
    } finally { setSaving(false); }
  }

  async function loadVoices(which: "el" | "hg") {
    setLoadingVoices(which);
    try {
      const r = await fetch(`/api/voices/${which === "el" ? "elevenlabs" : "heygen"}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`${tr("Impossible de charger les voix", "Couldn't load voices")} : ${j.error || r.statusText}`); return; }
      if (which === "el") setElVoices(j.voices ?? []); else setHgVoices(j.voices ?? []);
    } finally { setLoadingVoices(null); }
  }

  const field = (label: string, key: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={val(key)} onChange={(e) => set(key, e.target.value)} />
    </div>
  );

  const voicePicker = (label: string, key: string, which: "el" | "hg", voices: Voice[] | null) => (
    <div>
      <label className="label">{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" style={{ flex: 1 }} value={val(key)} onChange={(e) => set(key, e.target.value)} placeholder="voice_id" />
        <button className="btn btn-ghost" style={{ fontSize: 12.5, whiteSpace: "nowrap" }} disabled={loadingVoices === which} onClick={() => loadVoices(which)}>
          {loadingVoices === which ? "…" : tr("Charger les voix", "Load voices")}
        </button>
      </div>
      {voices && voices.length > 0 && (
        <select className="input" style={{ marginTop: 8 }} value="" onChange={(e) => e.target.value && set(key, e.target.value)}>
          <option value="">{tr(`— choisir une voix (${voices.length}) —`, `— pick a voice (${voices.length}) —`)}</option>
          {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <div>
      <h1>{tr("Paramètres — Clés API", "Settings — API keys")}</h1>
      <p className="muted" style={{ marginBottom: 18, fontSize: 14 }}>
        {tr(
          "Stockées localement (SQLite). Réutilisées automatiquement. Les clés masquées (•••) restent inchangées si vous n'y touchez pas.",
          "Stored locally (SQLite). Reused automatically. Masked keys (•••) stay unchanged if you don't touch them."
        )}
      </p>

      <div className="card" style={{ display: "grid", gap: 16 }}>
        {field(tr("ElevenLabs — clé API", "ElevenLabs — API key"), "ELEVENLABS_API_KEY")}
        {voicePicker(tr("ElevenLabs — voice_id (narration)", "ElevenLabs — voice_id (narration)"), "ELEVENLABS_VOICE_ID", "el", elVoices)}
        {field(tr("kie.ai — clé API (nano-banana / Veo)", "kie.ai — API key (nano-banana / Veo)"), "KIE_API_KEY")}
        {field(tr("HeyGen — clé API", "HeyGen — API key"), "HEYGEN_API_KEY")}
        {voicePicker(tr("HeyGen — voice_id (voix de l'avatar)", "HeyGen — voice_id (avatar voice)"), "HEYGEN_VOICE_ID", "hg", hgVoices)}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {field(tr("Pexels — clé API (optionnel)", "Pexels — API key (optional)"), "PEXELS_API_KEY")}
          {field(tr("Pixabay — clé API (optionnel)", "Pixabay — API key (optional)"), "PIXABAY_API_KEY")}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "grid", gap: 16 }}>
          <div className="faint" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{tr("Avancé", "Advanced")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label className="label">{tr("Provider IA", "AI provider")}</label>
              <select className="input" value={val("AI_PROVIDER") || "kie"} onChange={(e) => set("AI_PROVIDER", e.target.value)}>
                <option value="kie">kie.ai (nano-banana / Veo)</option>
                <option value="69labs">69labs (Grok)</option>
              </select>
            </div>
            <div>
              <label className="label">{tr("Média IA (kie.ai)", "AI media (kie.ai)")}</label>
              <select className="input" value={val("KIE_AI_MEDIA") || "image"} onChange={(e) => set("KIE_AI_MEDIA", e.target.value)}>
                <option value="image">{tr("Images (nano-banana + zoom)", "Images (nano-banana + zoom)")}</option>
                <option value="video">{tr("Vidéo (Veo, + réaliste, + cher)", "Video (Veo, more realistic, pricier)")}</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label className="label">{tr("Fournisseur de voix", "Voice provider")}</label>
              <select className="input" value={val("VOICEOVER_PROVIDER") || "elevenlabs"} onChange={(e) => set("VOICEOVER_PROVIDER", e.target.value)}>
                <option value="elevenlabs">ElevenLabs (direct)</option>
                <option value="69labs">69labs (ElevenLabs / EdgeTTS / clone)</option>
                <option value="heygen">HeyGen</option>
                <option value="minimax">MiniMax</option>
              </select>
            </div>
            {field(tr("Groq — clé API (timing si voix ≠ ElevenLabs)", "Groq — API key (timing when voice ≠ ElevenLabs)"), "GROQ_API_KEY")}
          </div>
          {val("VOICEOVER_PROVIDER") === "69labs" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                padding: "12px 14px",
                background: "var(--surface-2)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div>
                <label className="label">{tr("69labs — Type de voix", "69labs — Voice Engine")}</label>
                <select className="input" value={val("TTS_VOICE_PROVIDER") || ""} onChange={(e) => set("TTS_VOICE_PROVIDER", e.target.value)}>
                  <option value="">{tr("Détection automatique (recommandé)", "Auto-detect from Voice ID (recommended)")}</option>
                  <option value="elevenlabs">ElevenLabs (via 69labs)</option>
                  <option value="edgetts">EdgeTTS (Microsoft)</option>
                  <option value="voice-clone">Voice Clone (69labs)</option>
                </select>
              </div>
              {field(tr("69labs — Voice ID (ex: ID ElevenLabs ou en-US-GuyNeural)", "69labs — Voice ID (e.g. ElevenLabs ID or en-US-GuyNeural)"), "TTS_VOICE_ID")}
            </div>
          )}
          <div className="faint" style={{ fontSize: 12 }}>
            {tr(
              "ElevenLabs (direct) donne le minutage des mots nativement. Pour 69labs / HeyGen / MiniMax, le minutage vient de Groq Whisper (clé gratuite) — sinon réparti proportionnellement. Configure la voix de ces fournisseurs dans Réglages complets.",
              "Direct ElevenLabs gives native word timing. For 69labs / HeyGen / MiniMax, timing comes from Groq Whisper (free key) — otherwise spread proportionally. Configure those providers' voice in full settings."
            )}
          </div>
          {field(tr("Google Gemini — clé API (requêtes visuelles)", "Google Gemini — API key (visual queries)"), "GOOGLE_API_KEY")}
          {field(tr("69labs — clé API (si provider 69labs)", "69labs — API key (if provider is 69labs)"), "LABS69_API_KEY")}
          {field(tr("Style images IA par défaut", "Default AI image style"), "AI_IMAGE_STYLE")}

          <div>
            <label className="label">{tr("Sources de footage réel (1ère = priorité)", "Real footage sources (1st = priority)")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 8 }}>
              {ALL_FOOTAGE.map((src) => (
                <label key={src.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={footageList().includes(src.id)} onChange={() => toggleFootage(src.id)} />
                  {src.label}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>{tr("Priorité :", "Priority:")}</span>
              <select className="input" style={{ maxWidth: 240 }} value={footageList()[0] ?? ""} onChange={(e) => setFootagePriority(e.target.value)}>
                {footageList().map((id) => (
                  <option key={id} value={id}>{ALL_FOOTAGE.find((f) => f.id === id)?.label ?? id}</option>
                ))}
              </select>
            </div>
            <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
              {tr(
                "La 1ère source est essayée en premier. Pour un rendu moins « stock », mets Wikimedia / Openverse en priorité (images d'archive réelles) et garde Pexels / Pixabay en secours. Ajoute leurs clés API ci-dessus.",
                "The first source is tried first. For a less 'stock' look, prioritize Wikimedia / Openverse (real archive imagery) and keep Pexels / Pixabay as fallback. Add their API keys above."
              )}
            </div>
          </div>

          <div className="faint" style={{ fontSize: 12 }}>
            {tr("Autres options avancées :", "Other advanced options:")}{" "}
            <Link href="/settings">{tr("réglages complets →", "full settings →")}</Link>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn" onClick={save} disabled={saving || Object.keys(dirty).length === 0}>
            {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
          </button>
          {savedAt && <span className="faint" style={{ fontSize: 12.5 }}>{tr("Enregistré à", "Saved at")} {savedAt}</span>}
        </div>
      </div>
    </div>
  );
}
