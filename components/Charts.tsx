"use client";

// Charts drawn as plain SVG: a trend sparkline with a target line, and a
// patient's PHQ-9 trajectory over the severity bands.

import { useEffect, useRef, useState } from "react";
import { useTip } from "./Providers";
import { MONTHS, PHQ_SEVERITY, fmtDate, fmtDateY, parseD, pct, phqSeverity, DAY_MS } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Spark({ values, months, target, height = 46, label, fmt = pct }: {
  values: (number | null)[]; months: string[]; target?: number | null; height?: number; label: string; fmt?: (v: number) => string;
}) {
  const [ref, w0] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const tip = useTip();
  const W = Math.max(120, w0 || 200), H = height, padX = 4, padT = 5, padB = 5;
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[];
  const n = values.length;
  if (pts.length < 2)
    return <div className="spark" ref={ref} style={{ height: H }}><span className="muted" style={{ fontSize: 11 }}>Not enough history</span></div>;
  const vals = pts.map((p) => p.v).concat(target != null ? [target] : []);
  let lo = Math.min(...vals), hiV = Math.max(...vals);
  const span = Math.max(hiV - lo, 0.08), mid = (hiV + lo) / 2;
  lo = Math.max(0, mid - span * 0.65); hiV = Math.min(1, mid + span * 0.65);
  if (hiV - lo < 0.05) hiV = lo + 0.05;
  if (hiV > 1 && lo === 0) hiV = Math.max(...vals) * 1.1; // values above 100% (utilization)
  if (Math.max(...vals) > hiV) hiV = Math.max(...vals) * 1.05;
  const x = (i: number) => padX + (i / (n - 1)) * (W - padX * 2);
  const y = (v: number) => padT + (1 - (v - lo) / (hiV - lo)) * (H - padT - padB);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(pts[pts.length - 1].i).toFixed(1)} ${H - padB} L${x(pts[0].i).toFixed(1)} ${H - padB} Z`;
  const last = pts[pts.length - 1];
  const hp = hi != null ? pts.find((p) => p.i === hi) : null;

  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect(), mx = ((ev.clientX - r.left) / r.width) * W;
    let best = pts[0];
    pts.forEach((p) => { if (Math.abs(x(p.i) - mx) < Math.abs(x(best.i) - mx)) best = p; });
    setHi(best.i);
    const lab = best.i === n - 1 ? `Today (${fmtDate(months[best.i])})` : `${MONTHS[parseD(months[best.i]).getMonth()]} ${parseD(months[best.i]).getFullYear()} close`;
    tip.show(<><b>{fmt(best.v)}</b> · {lab}{target != null && <><br />Target {fmt(target)}</>}</>, ev.clientX, ev.clientY);
  };
  return (
    <div className="spark" ref={ref} style={{ height: H }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => { setHi(null); tip.hide(); }}>
        {target != null && <line x1={padX} x2={W - padX} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />}
        <path d={area} fill="var(--series-soft)" stroke="none" />
        <path d={d} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill="var(--series)" stroke="var(--panel)" strokeWidth={2} />
        {hp && <circle cx={x(hp.i)} cy={y(hp.v)} r={4} fill="var(--series)" stroke="var(--panel)" strokeWidth={2} />}
      </svg>
    </div>
  );
}

const SEV_SHORT: Record<string, string> = { "Moderately severe": "Mod. severe" };

export function PhqChart({ assessments }: { assessments: any[] }) {
  const [ref, w0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hi, setHi] = useState<number | null>(null);
  const pts = assessments.filter((a) => a[1] === "PHQ").map((a) => ({ d: parseD(a[0]).getTime(), s: a[2] as number, iso: a[0] as string }));
  const risk = new Set(assessments.filter((a) => a[1] === "RISK" && a[2] === 1).map((a) => a[0]));
  if (!pts.length) return <p className="muted">No PHQ-9 on file.</p>;
  const W = Math.max(280, w0 || 600), H = 230, L = 34, R = 84, T = 10, B = 26;
  const d0 = pts[0].d - 7 * DAY_MS, d1 = Math.max(pts[pts.length - 1].d + 7 * DAY_MS, d0 + 60 * DAY_MS);
  const x = (d: number) => L + ((d - d0) / (d1 - d0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 27) * (H - T - B);
  const ticks: Date[] = [];
  let c = new Date(new Date(d0).getFullYear(), new Date(d0).getMonth() + 1, 1);
  while (c.getTime() < d1) { ticks.push(new Date(c)); c = new Date(c.getFullYear(), c.getMonth() + 1, 1); }
  const every = Math.ceil(ticks.length / Math.max(2, Math.floor((W - L - R) / 70)));
  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect(), mx = ((ev.clientX - r.left) / r.width) * W;
    let b = 0;
    pts.forEach((q, i) => { if (Math.abs(x(q.d) - mx) < Math.abs(x(pts[b].d) - mx)) b = i; });
    setHi(b);
    const q = pts[b];
    tip.show(<><b>PHQ-9 {q.s}</b> · {phqSeverity(q.s)}<br />{fmtDateY(q.iso)}{risk.has(q.iso) && <><br />Positive suicide-risk screen</>}</>, ev.clientX, ev.clientY);
  };
  return (
    <div className="chartbox" ref={ref}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PHQ-9 scores over time" onPointerMove={onMove} onPointerLeave={() => { setHi(null); tip.hide(); }}>
        {PHQ_SEVERITY.map((s, i) => (
          <g key={s[2]}>
            {i % 2 === 0 && <rect x={L} y={y(Math.min(27, s[1] + 0.5))} width={W - L - R} height={y(Math.max(0, s[0] - 0.5)) - y(Math.min(27, s[1] + 0.5))} fill="var(--panel-2)" />}
            <text x={W - R + 8} y={y((s[0] + Math.min(s[1], 27)) / 2) + 4} fill="var(--muted)" fontSize={11}>{SEV_SHORT[s[2]] || s[2]}</text>
          </g>
        ))}
        {[0, 5, 10, 15, 20, 27].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} fill="var(--muted)" fontSize={11} textAnchor="end">{v}</text>
          </g>
        ))}
        {ticks.map((tk, i) => i % every ? null : (
          <text key={tk.getTime()} x={x(tk.getTime())} y={H - 8} fill="var(--muted)" fontSize={11} textAnchor="middle">
            {MONTHS[tk.getMonth()]}{tk.getMonth() === 0 ? ` ${String(tk.getFullYear()).slice(2)}` : ""}
          </text>
        ))}
        <path d={pts.map((q, i) => `${i ? "L" : "M"}${x(q.d).toFixed(1)} ${y(q.s).toFixed(1)}`).join(" ")} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((q) => (
          <g key={q.iso + q.s}>
            {risk.has(q.iso) && <circle cx={x(q.d)} cy={y(q.s)} r={7.5} fill="none" stroke="var(--mark-crit)" strokeWidth={2} />}
            <circle cx={x(q.d)} cy={y(q.s)} r={4} fill="var(--series)" stroke="var(--panel)" strokeWidth={2} />
          </g>
        ))}
        {hi != null && <circle cx={x(pts[hi].d)} cy={y(pts[hi].s)} r={5.5} fill="var(--series)" stroke="var(--panel)" strokeWidth={2} />}
      </svg>
    </div>
  );
}
