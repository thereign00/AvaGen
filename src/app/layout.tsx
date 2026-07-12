import "./globals.css";
import type { ReactNode } from "react";
import { Sidebar } from "./_sidebar";
import { LangProvider } from "./_i18n";

export const metadata = {
  title: "AvaGen",
  description: "AvaGen Video Studio — HeyGen avatar + ElevenLabs voice, illustrated with real internet footage or AI b-roll.",
};

// Applied before first paint so the chosen theme doesn't flash (anti-FOUC).
// Lives as the first node inside <body> — a manual <head> in an App Router
// layout breaks hydration, so it must NOT go there.
const themeScript = `try{if(localStorage.getItem('theme')==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <LangProvider>
          <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", overflowX: "hidden" }}>
              <div style={{ width: "100%", maxWidth: 1100, padding: "32px 36px 80px" }}>
                {children}
              </div>
            </main>
          </div>
        </LangProvider>
      </body>
    </html>
  );
}
