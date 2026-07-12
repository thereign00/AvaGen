"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang, useT } from "./_i18n";

const NAV = [
  { href: "/", fr: "Créer une vidéo", en: "Create a video", exact: true },
  { href: "/avatars", fr: "Avatars", en: "Avatars" },
  { href: "/chaines", fr: "Chaînes", en: "Channels" },
  { href: "/jobs", fr: "Jobs", en: "Jobs" },
  { href: "/parametres", fr: "Paramètres", en: "Settings" },
];

export function TopNav() {
  const pathname = usePathname();
  const tr = useT();
  const { lang, setLang } = useLang();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 22px",
        background: "var(--bg-deep)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(6px)",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
        <span style={{ fontSize: 17 }}>🎬</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          Faceless Video Generator
        </span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <nav style={{ display: "flex", gap: 4 }}>
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "7px 13px",
                  borderRadius: 8,
                  fontSize: 13.5,
                  fontWeight: active ? 650 : 500,
                  color: active ? "var(--fg)" : "var(--fg-muted)",
                  background: active ? "var(--surface-2)" : "transparent",
                  border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                  textDecoration: "none",
                  transition: "background 0.13s, color 0.13s",
                }}
              >
                {tr(item.fr, item.en)}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
