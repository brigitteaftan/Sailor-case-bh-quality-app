"use client";

// Dashboard: today's urgent escalations, pod KPIs, therapist scorecard, Monday digest.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useThresholds, useToast } from "./Providers";
import { Spark } from "./Charts";
import { Icon, Pill, PriorityChip, StatusChip, URGENT_CAT, shortName } from "./ui";
import {
  DOMAINS, MDEF, OVERALL_ORDER, SCORED, SHORT, pctS, providerAlerts, rateTherapists, reasons, scorecardChanges,
  statusOf, targetText, type Overall, type Rated,
} from "@/lib/rating";
import { fmtDate, fmtDateY, longDate, pct, tenureText } from "@/lib/format";
import { store, resolutionKey, type Resolution } from "@/lib/storage";

type Props = { summary: any; names: Record<string, string> };

export default function Dashboard({ summary, names }: Props) {
  const { th } = useThresholds();
  const rated = useMemo(() => rateTherapists(th, summary.therapists), [th, summary]);
  const T = useMemo(() => Object.fromEntries(summary.therapists.map((t: any) => [t.id, t])), [summary]);
  return (
    <>
      <UrgentList summary={summary} names={names} T={T} />
      <Scorecard summary={summary} rated={rated} />
      <Kpis summary={summary} />
      <Digest summary={summary} names={names} T={T} />
    </>
  );
}

/* ---------------- Today's urgent escalations ---------------- */
function UrgentList({ summary, names, T }: { summary: any; names: Record<string, string>; T: Record<string, any> }) {
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { toast, node } = useToast();
  useEffect(() => setResolved(store.get("resolved", {})), []);
  const save = (next: Record<string, Resolution>) => { setResolved(next); store.set("resolved", next); };

  const items = [...summary.notifications.daily.items].sort(
    (a: any, b: any) => URGENT_CAT[a.flag].rank - URGENT_CAT[b.flag].rank || b.days_open - a.days_open);
  const open = items.filter((f: any) => !resolved[resolutionKey(f)]);
  const done = items.filter((f: any) => resolved[resolutionKey(f)]);
  const escN = open.filter((f: any) => f.escalated).length, newN = open.filter((f: any) => f.new_since_monday).length;

  return (
    <section className="block" id="urgent">
      <div className="sec-head">
        <div>
          <div className="eyebrow">Daily · {longDate(summary.notifications.daily.date)}</div>
          <h2>Today’s urgent escalations</h2>
        </div>
        <div className="right urgent-summary">
          <span className="chip c-urgent">{open.length} open</span>
          {escN > 0 && <span className="chip c-esc">{escN} escalated to clinical director</span>}
          {newN > 0 && <span className="chip c-new">{newN} new since Monday</span>}
        </div>
      </div>
      <div className="alist">
        {!open.length && <div className="empty">No open urgent escalations.</div>}
        {open.map((f: any) => {
          const c = URGENT_CAT[f.flag], k = resolutionKey(f);
          return (
            <div className="arow" key={k}>
              <div className="ic" aria-hidden="true"><Icon name={c.icon} /></div>
              <div className="main">
                <div className="line1">
                  <span className="cat">{c.label}</span>
                  <Link className="linkish" href={`/patients/${f.patient_id}`}>{names[f.patient_id]} · {f.patient_id}</Link>
                  <span className="who">{T[f.therapist_id].name}</span>
                  {f.new_since_monday && <span className="chip c-new">New since Monday</span>}
                  {f.escalated && <span className="chip c-esc">Escalated · open &gt; 48h</span>}
                </div>
                <div className="detail">{f.detail}</div>
                <div className="action"><b>Next step:</b> {f.recommended_action} <span className="muted">· Owner: {f.owner}</span></div>
              </div>
              <div className="side">
                <span className="days">{f.days_open === 0 ? "Opened today" : `Open ${f.days_open} ${f.days_open === 1 ? "day" : "days"}`}</span>
                <div className="btns">
                  <Link className="btn small" href={`/patients/${f.patient_id}`}>Open chart</Link>
                  <button className="btn small primary" onClick={() => { setOpenForm(openForm === k ? null : k); setNote(""); }}>Resolve</button>
                </div>
              </div>
              {openForm === k && (
                <form className="resolve-form" onSubmit={(e) => {
                  e.preventDefault();
                  save({ ...resolved, [k]: { note: note.trim(), at: new Date().toISOString() } });
                  setOpenForm(null); toast("Marked resolved");
                }}>
                  <label htmlFor={`note-${k}`} className="ink2" style={{ fontSize: 13, fontWeight: 600 }}>What happened? This note goes in the audit trail.</label>
                  <textarea id={`note-${k}`} autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Spoke with therapist 10am; safety plan completed with patient by phone; no current intent." />
                  <div className="row">
                    <button type="button" className="btn small" onClick={() => setOpenForm(null)}>Cancel</button>
                    <button type="submit" className="btn small primary">Mark resolved</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <details className="resolved">
          <summary>Resolved ({done.length})</summary>
          {done.map((f: any) => {
            const r = resolved[resolutionKey(f)];
            return (
              <div className="rrow" key={resolutionKey(f)}>
                <div>
                  <b>{URGENT_CAT[f.flag].label}</b> · {names[f.patient_id]} · {T[f.therapist_id].name}
                  <div className="note">{r.note || "No note"} <span className="muted">· resolved {new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
                </div>
                <button className="btn small" onClick={() => { const n = { ...resolved }; delete n[resolutionKey(f)]; save(n); toast("Reopened"); }}>Reopen</button>
              </div>
            );
          })}
          <p className="note">Demo: resolutions are saved in this browser. In production they go to the shared database with the user’s name.</p>
        </details>
      )}
      {node}
    </section>
  );
}

/* ---------------- Pod KPIs ---------------- */
const KPI_IDS = ["improvement", "remission", "followup_assessment", "safety_response", "early_dropout", "notes_48h", "claims_first_pass"];
function Kpis({ summary }: { summary: any }) {
  const { th } = useThresholds();
  const pm = summary.pod.metrics, months = summary.trends.months;
  return (
    <section className="block" id="kpis">
      <div className="sec-head">
        <div><div className="eyebrow">Pod performance</div><h2>Pod at a glance</h2></div>
        <div className="right"><span className="sub">{summary.therapists.length} therapists · {pm.active_caseload.value} active patients · avg intake PHQ-9 {pm.avg_baseline_phq.value}</span></div>
      </div>
      <div className="kpis">
        {KPI_IDS.map((k) => {
          const m = pm[k], st = statusOf(th, k, m.value, m.den);
          return (
            <div className="kpi" key={k}>
              <div className="lbl"><span>{MDEF[k].label}</span><StatusChip s={st} /></div>
              <div className="val">{pctS(th, k, m.value, st)}</div>
              <div className="tgt">{targetText(th, k)} · {m.num} of {m.den}</div>
              <Spark values={summary.trends.pod[k]} months={months} target={th.metrics[k].target} label={`${MDEF[k].label} over 12 months`} />
            </div>
          );
        })}
        <div className="kpi">
          <div className="lbl"><span>Hours filled / offered</span><span className="chip c-context">Context</span></div>
          <div className="val">{pct(pm.utilization.value)}</div>
          <div className="tgt">{pm.filled_hours.value} of {pm.available_hours.value} clinical hours a week filled (last 4 weeks)</div>
          <Spark values={summary.trends.pod.utilization} months={months} label="Utilization over 12 months" />
        </div>
      </div>
    </section>
  );
}

/* ---------------- Therapist scorecard ---------------- */
const FILTERS: (Overall | "All")[] = ["All", "Needs attention", "Watch", "On track", "Excelling", "Too early to rate"];
function Scorecard({ summary, rated }: { summary: any; rated: Rated[] }) {
  const { th } = useThresholds();
  const router = useRouter();
  const [filter, setFilter] = useState<Overall | "All">("All");
  useEffect(() => setFilter(store.get("ofilter", "All")), []);
  const counts: Record<string, number> = {};
  rated.forEach((r) => (counts[r.overall] = (counts[r.overall] || 0) + 1));
  let rows = [...rated].sort((a, b) => OVERALL_ORDER[a.overall] - OVERALL_ORDER[b.overall] || reasons(b).length - reasons(a).length);
  if (filter !== "All") rows = rows.filter((r) => r.overall === filter);
  const groups = DOMAINS.map((d) => SCORED.filter((k) => MDEF[k].domain === d));
  const pm = summary.pod.metrics;
  const cell = (k: string, v: any, s: string, j: number) => {
    const txt = s === "insufficient" ? (v.den ? `n=${v.den}` : "—")
      : k === "available_hours_pct" ? `${v.num}/${v.den}h` : pctS(th, k, v.value, s as any);
    return (
      <td key={k} className={j === 0 ? "g" : ""}>
        <span className={`cell ${s}`} title={`${MDEF[k].label}: ${v.value == null ? "no data" : pct(v.value)} (${v.num ?? 0} of ${v.den ?? 0}). ${targetText(th, k)}`}>
          {s === "below" ? "✕ " : s === "watch" ? "! " : ""}{txt}
        </span>
      </td>
    );
  };
  return (
    <section className="block" id="scorecard">
      <div className="sec-head">
        <div><div className="eyebrow">Therapist performance</div><h2>Therapist scorecard</h2></div>
        <div className="right">
          <div className="seg" role="group" aria-label="Filter by rating">
            {FILTERS.filter((o) => o === "All" || counts[o]).map((o) => (
              <button key={o} aria-pressed={filter === o} onClick={() => { setFilter(o); store.set("ofilter", o); }}>
                {o === "Too early to rate" ? "Too early" : o}{o === "All" ? "" : ` ${counts[o]}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="tablebox">
        <table className="score">
          <thead>
            <tr className="dom">
              <th className="name"></th>
              {groups.map((g, i) => <th key={DOMAINS[i]} className="g" colSpan={g.length}>{DOMAINS[i]}</th>)}
              <th className="g" colSpan={1}>Context</th>
            </tr>
            <tr>
              <th className="name">Therapist · rating</th>
              {groups.map((g) => g.map((k, j) => (
                <th key={k} className={j === 0 ? "g" : ""} title={`${MDEF[k].label}. ${targetText(th, k)}`}>{SHORT[k]}</th>
              )))}
              <th className="g">Active pts</th>
            </tr>
            <tr className="tgt-row">
              <th className="name">Target</th>
              {groups.map((g) => g.map((k, j) => (
                <th key={k} className={j === 0 ? "g" : ""}>{MDEF[k].direction === "higher" ? "≥" : "≤"}{pct(th.metrics[k].target)}</th>
              )))}
              <th className="g"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = r.t, m = t.metrics;
              return (
                <tr key={t.id} onClick={() => router.push(`/therapists/${t.id}`)}>
                  <td className="name">
                    <Link href={`/therapists/${t.id}`} className="tname" style={{ color: "var(--ink)", textDecoration: "none" }}>{t.name}</Link>
                    <span className="tsub">{t.credential} · {tenureText(t.tenure_months)}</span>
                    <span className="trate"><Pill o={r.overall} /></span>
                  </td>
                  {groups.map((g) => g.map((k, j) => cell(k, m[k], r.st[k], j)))}
                  <td className="g">{m.active_caseload.value}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="name">Pod total</td>
              {groups.map((g) => g.map((k, j) => cell(k, pm[k], statusOf(th, k, pm[k].value, pm[k].den), j)))}
              <td className="g">{pm.active_caseload.value}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="legend">
        <span className="chip c-meets"><span className="i">✓</span>Meets target</span>
        <span className="chip c-watch"><span className="i">!</span>Between target and flag line</span>
        <span className="chip c-below"><span className="i">✕</span>Past flag line</span>
        <span className="chip c-insufficient">n=… · not enough data</span>
        <span>Click a therapist for their full scorecard, trends and patients.</span>
      </div>
    </section>
  );
}

/* ---------------- Monday digest ---------------- */
type DTab = "urgent" | "provider" | "review" | "scorecard" | "shout";
function Digest({ summary, names, T }: { summary: any; names: Record<string, string>; T: Record<string, any> }) {
  const { th } = useThresholds();
  const [tab, setTab] = useState<DTab>("provider");
  const [rvT, setRvT] = useState("all");
  const [rvF, setRvF] = useState("all");
  useEffect(() => setTab(store.get("dtab", "provider")), []);
  const dg = summary.notifications.monday_digest;
  const prov = providerAlerts(th, summary), sc = scorecardChanges(th, summary);
  const shouts = sc.shout.concat(dg.shoutouts.filter((s: any) => s.category === "Patient milestones")
    .map((s: any) => ({ tid: s.therapist_id, kind: "Patient milestones", title: s.title, detail: s.detail, patients: s.patients })));
  const review = dg.patient_review;
  const tabs: [DTab, string, number][] = [
    ["urgent", "Open urgent", dg.open_urgent.length], ["provider", "Provider follow-ups", prov.out.length],
    ["review", "Patient review", review.length], ["scorecard", "Scorecard changes", sc.alerts.length], ["shout", "Shoutouts", shouts.length],
  ];
  const pick = (id: DTab) => { setTab(id); store.set("dtab", id); };
  const TName = ({ tid }: { tid: string }) => <Link className="linkish" href={`/therapists/${tid}`}>{shortName(T[tid].name)}</Link>;
  const PLink = ({ id }: { id: string }) => <Link className="linkish" href={`/patients/${id}`}>{names[id] || id}</Link>;

  let body: React.ReactNode = null;
  if (tab === "urgent") {
    body = (<>
      <div className="dlist">
        {dg.open_urgent.map((f: any) => (
          <div className="drow" key={resolutionKey(f)}>
            <div className="who"><TName tid={f.therapist_id} /></div>
            <div className="body"><div className="ttl">{URGENT_CAT[f.flag].label} · <PLink id={f.patient_id} /></div><div>{f.detail}</div><div className="ink2">{f.recommended_action}</div></div>
            <div className="meta"><span className="chip c-urgent">Urgent</span><span>Open {f.days_open} days</span>{f.escalated && <span className="chip c-esc">Escalated</span>}</div>
          </div>
        ))}
        {!dg.open_urgent.length && <div className="empty">No open urgent items on Monday.</div>}
      </div>
      <p className="note">Snapshot as of Monday. The live list is at the top of this page.</p>
    </>);
  } else if (tab === "provider") {
    const byT: Record<string, typeof prov.out> = {};
    prov.out.forEach((a) => (byT[a.tid] = byT[a.tid] || []).push(a));
    body = (<>
      <div className="dlist">
        {Object.keys(byT).map((tid) => (
          <div key={tid}>
            <div className="groupHead"><Link className="linkish" href={`/therapists/${tid}`}>{T[tid].name}</Link><span className="muted" style={{ fontWeight: 500 }}>· Connect this week to get back on track</span></div>
            {byT[tid].map((a) => (
              <div className="drow" key={a.title}>
                <div className="who"><span className={`chip ${a.cat === "Access" ? "c-review" : "c-high"}`}>{a.cat}</span></div>
                <div className="body"><div className="ttl">{a.title}</div><div className="ink2">{a.detail}</div></div>
                <div className="meta"><span>Owner: Lead</span></div>
              </div>
            ))}
          </div>
        ))}
        {!prov.out.length && <div className="empty">No provider follow-ups at these thresholds.</div>}
      </div>
      {prov.suppressed.map((s) => <p className="note" key={s.tid}>{T[s.tid].name}: {s.reason}</p>)}
    </>);
  } else if (tab === "review") {
    const types = Array.from(new Set(review.map((f: any) => f.flag))) as string[];
    const rows = review.filter((f: any) => (rvT === "all" || f.therapist_id === rvT) && (rvF === "all" || f.flag === rvF));
    const byT: Record<string, any[]> = {};
    rows.forEach((f: any) => (byT[f.therapist_id] = byT[f.therapist_id] || []).push(f));
    body = (<>
      <div className="filters">
        <label htmlFor="rvT" className="ink2">Therapist</label>
        <select className="sel" id="rvT" value={rvT} onChange={(e) => setRvT(e.target.value)}>
          <option value="all">All therapists</option>
          {summary.therapists.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label htmlFor="rvF" className="ink2">Type</label>
        <select className="sel" id="rvF" value={rvF} onChange={(e) => setRvF(e.target.value)}>
          <option value="all">All types</option>
          {types.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="muted">{rows.length} items</span>
      </div>
      <div className="dlist">
        {Object.keys(byT).sort().map((tid) => (
          <div key={tid}>
            <div className="groupHead"><Link className="linkish" href={`/therapists/${tid}`}>{T[tid].name}</Link><span className="muted" style={{ fontWeight: 500 }}>· {byT[tid].length} for supervision or outreach</span></div>
            {byT[tid].map((f) => (
              <div className="drow" key={resolutionKey(f)}>
                <div className="who"><PriorityChip p={f.priority} /></div>
                <div className="body"><div className="ttl">{f.flag} · <PLink id={f.patient_id} /></div><div>{f.detail}</div><div className="ink2">{f.recommended_action}</div></div>
                <div className="meta"><span>Owner: {f.owner}</span><span>Since {fmtDate(f.since)}</span></div>
              </div>
            ))}
          </div>
        ))}
        {!rows.length && <div className="empty">Nothing matches these filters.</div>}
      </div>
      <p className="note">
        New since last Monday, plus anything High priority.
        {dg.review_backlog != null && dg.review_backlog > review.length && <> {dg.review_backlog - review.length} ongoing items stay on each therapist’s page for their 1:1s.</>}
      </p>
    </>);
  } else if (tab === "scorecard") {
    body = (<>
      <div className="dlist">
        {sc.alerts.map((a) => (
          <div className="drow" key={a.tid + a.title}>
            <div className="who"><TName tid={a.tid} /></div>
            <div className="body"><div className="ttl">{a.title}</div><div className="ink2">{a.detail}</div><div className="ink2">Next step: performance conversation.</div></div>
            <div className="meta"><span className="chip c-below">Past flag</span><span>Owner: Lead</span></div>
          </div>
        ))}
        {!sc.alerts.length && <div className="empty">No KPI newly fell past its flag line in the last 2 weeks.</div>}
      </div>
      <p className="note">Compares this Monday ({fmtDate(sc.to)}) with two weeks earlier ({fmtDate(sc.from)}). New hires are excluded for their first {th.provider.ramp} days.</p>
    </>);
  } else {
    body = (<>
      <div className="dlist">
        {shouts.map((s) => (
          <div className="drow" key={s.tid + s.title}>
            <div className="who"><TName tid={s.tid} /></div>
            <div className="body"><div className="ttl">{s.title}</div><div className="ink2">{s.detail}</div>
              {s.patients && <div className="ink2">{s.patients.map((p, i) => <span key={p}>{i ? ", " : ""}<PLink id={p} /></span>)}</div>}</div>
            <div className="meta"><span className="chip c-recog">{s.kind}</span></div>
          </div>
        ))}
        {!shouts.length && <div className="empty">No shoutouts this week.</div>}
      </div>
      <p className="note">Goals count once they’ve held for 2 weeks. Remission milestones: PHQ-9 below 5 for the first time, after starting at 10 or higher, in the last 30 days.</p>
    </>);
  }

  return (
    <section className="block" id="digest">
      <div className="sec-head">
        <div><div className="eyebrow">Monday digest · {longDate(dg.date)}</div><h2>This week’s digest</h2></div>
        <div className="right"><span className="sub">Full state of the pod, sent every Monday</span></div>
      </div>
      <div className="subtabs" role="tablist">
        {tabs.map(([id, l, n]) => (
          <button key={id} className="subtab" role="tab" aria-selected={tab === id} onClick={() => pick(id)}>{l}<span className="n">{n}</span></button>
        ))}
      </div>
      {body}
    </section>
  );
}
