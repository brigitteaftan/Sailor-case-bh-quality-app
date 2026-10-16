"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export default function Header({ pod, asOf, source }: { pod: string; asOf: string; source: string }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const tabs = [
    { href: "/", label: "Dashboard", active: path === "/" || path.startsWith("/therapists") || path.startsWith("/patients") },
    { href: "/rules", label: "Rules", active: path.startsWith("/rules") },
  ];
  return (
    <header className="top">
      <div className="wrap">
        <div className="brand">
          <h1><Link href="/" style={{ color: "inherit", textDecoration: "none" }}>Pod Quality Console</Link></h1>
          <span className="pod">{pod}</span>
        </div>
        <div className="top-meta">
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/patients?q=${encodeURIComponent(q.trim())}`); }}>
            <label htmlFor="psearch" className="muted" style={{ position: "absolute", left: -9999 }}>Find a patient</label>
            <input id="psearch" type="search" placeholder="Find a patient" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <span className="tag">As of {asOf}</span>
          {source === "mock" && <span className="tag">Mock data · prototype</span>}
        </div>
        <nav className="tabs" aria-label="Sections">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="tab" aria-current={t.active ? "page" : undefined} aria-selected={t.active}>{t.label}</Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
