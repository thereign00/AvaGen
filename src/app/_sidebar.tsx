"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "./_theme-toggle";
import { useLang, useT } from "./_i18n";
import { usePersistedState } from "./_use-persisted-state";

interface NavItem {
  href: string;
  fr: string;
  en: string;
  icon: ReactNode;
  exact?: boolean;
}

interface NavGroup {
  headerFr: string | null;
  headerEn: string | null;
  items: NavItem[];
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const NAV: NavGroup[] = [
  {
    headerFr: "Studio",
    headerEn: "Studio",
    items: [
      {
        href: "/",
        fr: "Créer une vidéo",
        en: "Create a video",
        exact: true,
        icon: (
          <svg {...iconProps}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        ),
      },
      {
        href: "/avatars",
        fr: "Avatars",
        en: "Avatar library",
        icon: (
          <svg {...iconProps}>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
          </svg>
        ),
      },
      {
        href: "/chaines",
        fr: "Chaînes & Styles",
        en: "Channels & Styles",
        icon: (
          <svg {...iconProps}>
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        ),
      },
    ],
  },
  {
    headerFr: "Historique",
    headerEn: "Work & History",
    items: [
      {
        href: "/jobs",
        fr: "Vidéos & Jobs",
        en: "Jobs & History",
        icon: (
          <svg {...iconProps}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5M12 7v5l4 2" />
          </svg>
        ),
      },
    ],
  },
  {
    headerFr: "Configuration",
    headerEn: "Setup",
    items: [
      {
        href: "/parametres",
        fr: "Paramètres & Clés",
        en: "Settings & Keys",
        icon: (
          <svg {...iconProps}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const tr = useT();
  const { lang, setLang } = useLang();
  // Sidebar is open by default (collapsed = false)
  const [collapsed, setCollapsed] = usePersistedState<boolean>("sidebar_collapsed_v2", false);

  return (
    <aside
      style={{
        width: collapsed ? 72 : 256,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        background: "var(--bg-deep)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "18px 10px" : "20px 16px",
        transition: "width 0.24s cubic-bezier(0.16, 1, 0.3, 1), padding 0.24s cubic-bezier(0.16, 1, 0.3, 1)",
        zIndex: 30,
        overflowX: "hidden",
        userSelect: "none",
      }}
    >
      {/* Header / Logo bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          paddingBottom: 22,
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textDecoration: "none",
            color: "inherit",
          }}
          title={tr("Accueil Studio", "Studio Home")}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg, var(--accent), #ff8a72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 17,
              color: "#fff",
              boxShadow: "0 3px 10px rgba(255,107,80,0.25)",
              flexShrink: 0,
            }}
          >
            🎬
          </div>
          {!collapsed && (
            <div style={{ lineHeight: 1.2, whiteSpace: "nowrap" }}>
              <div style={{ fontWeight: 750, fontSize: 14.5, letterSpacing: "-0.02em", color: "var(--fg)" }}>
                AvaGen
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-faint)", fontWeight: 500 }}>
                AI Video Studio
              </div>
            </div>
          )}
        </Link>

        {/* Toggle Collapse Button */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? tr("Ouvrir le menu", "Expand sidebar") : tr("Réduire le menu", "Collapse sidebar")}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--fg-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.15s ease",
            position: collapsed ? "absolute" : "relative",
            bottom: collapsed ? 8 : "auto",
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {collapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {/* Navigation list */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1, overflowY: "auto" }}>
        {NAV.map((group, gi) => (
          <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {!collapsed && (
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 750,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--fg-faint)",
                  padding: "2px 10px 4px",
                  whiteSpace: "nowrap",
                }}
              >
                {tr(group.headerFr ?? "", group.headerEn ?? "")}
              </div>
            )}

            {group.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");

              const label = tr(item.fr, item.en);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? label : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: 12,
                    padding: collapsed ? "10px 0" : "9px 12px",
                    borderRadius: 9,
                    fontSize: 13.5,
                    fontWeight: active ? 650 : 500,
                    color: active ? "var(--fg)" : "var(--fg-muted)",
                    background: active ? "var(--surface-2)" : "transparent",
                    border: `1px solid ${active ? "var(--border-strong)" : "transparent"}`,
                    textDecoration: "none",
                    transition: "background 0.15s, color 0.15s, border-color 0.15s",
                    position: "relative",
                  }}
                >
                  {active && !collapsed && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 6,
                        bottom: 6,
                        width: 3,
                        borderRadius: "0 3px 3px 0",
                        background: "var(--accent)",
                      }}
                    />
                  )}
                  <span
                    style={{
                      color: active ? "var(--accent)" : "var(--fg-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer controls: Theme Switcher & Version */}
      <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
        <ThemeToggle collapsed={collapsed} />

        {!collapsed && (
          <div style={{ fontSize: 11, color: "var(--fg-faint)", textAlign: "center", paddingTop: 2 }}>
            AvaGen v0.2.3 · runs locally
          </div>
        )}
      </div>
    </aside>
  );
}
