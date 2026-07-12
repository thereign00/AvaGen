"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useT } from "../_i18n";

interface Run {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  output_path: string | null;
  config_json: string | null;
}

function modeOf(cfg: string | null): string | null {
  if (!cfg) return null;
  try {
    const j = JSON.parse(cfg) as { visualMode?: string };
    return j.visualMode ?? null;
  } catch {
    return null;
  }
}

const BADGE: Record<string, { color: string; bg: string }> = {
  done: { color: "#15803d", bg: "rgba(34,197,94,0.15)" },
  running: { color: "#1d4ed8", bg: "rgba(59,130,246,0.15)" },
  pending: { color: "#b45309", bg: "rgba(245,158,11,0.14)" },
  error: { color: "#b91c1c", bg: "rgba(239,68,68,0.15)" },
  cancelled: { color: "#6b7280", bg: "rgba(107,114,128,0.15)" },
};

export default function JobsPage() {
  const tr = useT();
  const [runs, setRuns] = useState<Run[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/runs");
      const j = r.ok ? await r.json() : [];
      setRuns(Array.isArray(j) ? j : []);
    } catch {
      setRuns([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!runs.some((r) => r.status === "running" || r.status === "pending")) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [runs, load]);

  return (
    <div>
      <h1>{tr("Jobs", "Jobs")}</h1>
      <p className="muted" style={{ marginBottom: 18, fontSize: 14 }}>{tr("Historique des rendus.", "Render history.")}</p>

      {runs.length === 0 ? (
        <p className="faint" style={{ fontSize: 13.5 }}>{tr("Aucun rendu pour l'instant.", "No renders yet.")}</p>
      ) : (
        <div className="card" style={{ display: "grid", gap: 2, padding: 8 }}>
          {runs.map((r) => {
            const b = BADGE[r.status] ?? BADGE.pending;
            const mode = modeOf(r.config_json);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: b.color, background: b.bg, padding: "2px 8px", borderRadius: 999, textTransform: "uppercase" }}>{r.status}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.title || r.id.slice(0, 12)}
                  </span>
                  {mode && <span className="faint" style={{ fontSize: 12 }}>· {mode}</span>}
                </div>
                <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
                  {r.status === "done" && (
                    <a href={`/api/runs/${r.id}/file?p=final.mp4&download=1`} style={{ fontSize: 13 }}>⬇ mp4</a>
                  )}
                  <Link href={`/runs/${r.id}`} style={{ fontSize: 13 }}>{tr("Suivre", "Follow")}</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
