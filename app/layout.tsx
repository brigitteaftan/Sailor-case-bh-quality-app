import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import Header from "@/components/Header";
import { getSummary } from "@/lib/data";
import { longDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pod Quality Console",
  description: "Clinical quality console for a therapy pod: urgent escalations, therapist scorecards and the Monday digest.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const s = getSummary();
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <Providers>
          <Header pod={s.meta.pod} asOf={longDate(s.meta.as_of)} source={s.meta.source} />
          <main className="wrap">{children}</main>
          <footer className="wrap">
            <div className="foot">
              <span>{s.meta.source === "mock" ? "Synthetic data only. No real patients or providers." : "Contains PHI. Handle per policy."}</span>
              <span>Data computed {s.meta.computed_at?.replace("T", " ")}</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
