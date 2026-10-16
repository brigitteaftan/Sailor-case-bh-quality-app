"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useThresholds, useToast } from "./Providers";
import { Spark } from "./Charts";
import { Pill, PriorityChip, StatusChip } from "./ui";
import { DOMAINS, MDEF, SCORED, agendaFor, pctS, rateTherapists, targetText } from "@/lib/rating";
import { fmtDate, fmtDateY } from "@/lib/format";
import type { PatientRow } from "@/lib/data";

const ORDER = ["Urgent", "High", "Review", "Routine"];

export default function TherapistView({ summary, tid, patients, names }: {
  summary: any; tid: string; patients: PatientRow[]; names: Record<string, string>;
}) {
  const { th } = useThresholds();
  const router = useRouter();
  const { toast, node } = useToast();
  const r = useMemo(() => rateTherapists(th, summary.therapists).find((x) => x.t.id === tid)!, [th, summary, tid]);
  const t = r.t, m = t.metrics, sig = summary.notifications.provider_signals[tid];
  const flags = summary.case_flags.filter((f: any) => f.therapist_id === tid)
    .sort((a: any, b: any) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
  const agenda = agendaFor(th, r, summary, names);

  const copy = () => {
    const ok = () => toast("Copied");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(agenda).then(ok).catch(() => toast("Copy blocked. Select the text instead."));
    else toast("Copy blocked. Select the text instead.");
  };

  return (
    <>
      <div className="crumbs-bar"><Link href="/">Dashboard</Link><span>/</span><span>Therapists</span><span>/</span><span>{t.name}</span></div>
      <div className="dh"><h2>{t.name}</h2><Pill o={r.overall} /></div>
      <div className="facts">
        <span><b>{t.credential}</b></span><span>Hired <b>{fmtDateY(t.hire_date)}</b></span><span><b>{m.active_caseload.value}</b> active patients</span>
        <span><b>{m.filled_hours.value}</b> of <b>{sig.offered}</b> offered hours filled · {t.contracted_hours} contracted</span>
        <span>Avg intake PHQ-9 <b>{m.avg_baseline_phq.value ?? "—"}</b></span><span>Avg episode <b>{m.avg_episode_weeks.value ?? "—"}</b> weeks</span>
      </div>

      <div className="panel">
        <h3>Draft 1:1 agenda <span className="muted" style={{ fontWeight: 500, fontSize: 12.5 }}>Drafted from this week’s data. Edit before you use it.</span>
          <span className="r"><button className="btn small" onClick={copy}>Copy</button></span></h3>
        <pre className="agenda">{agenda}</pre>
      </div>

      {DOMAINS.map((dn) => (
        <div className="panel" key={dn}>
          <h3>{dn}</h3>
          <div className="mgrid">
            {SCORED.filter((k) => MDEF[k].domain === dn).map((k) => {
              const v = m[k], s = r.st[k];
              return (
                <div className="mcard" key={k}>
                  <div className="t"><span>{MDEF[k].label}</span><StatusChip s={s} /></div>
                  <div className="v">{pctS(th, k, v.value, s)}</div>
                  <div className="s">{v.num ?? 0} of {v.den ?? 0} · {targetText(th, k)}</div>
                  <Spark values={summary.trends.therapists[tid][k]} months={summary.trends.months} target={th.metrics[k].target} height={38} label={`${MDEF[k].label} trend`} />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="panel">
        <h3>Open patient items <span className="muted" style={{ fontWeight: 500 }}>{flags.length}</span></h3>
        {flags.length ? (
          <div className="dlist" style={{ border: 0 }}>
            {flags.map((f: any) => (
              <div className="drow" key={f.patient_id + f.flag + f.since} style={{ gridTemplateColumns: "90px minmax(0,1fr) auto", paddingInline: 0 }}>
                <div><PriorityChip p={f.priority} /></div>
                <div className="body"><div className="ttl">{f.flag} · <Link className="linkish" href={`/patients/${f.patient_id}`}>{names[f.patient_id]}</Link></div><div className="ink2">{f.detail}</div></div>
                <div className="meta"><span>{f.owner}</span></div>
              </div>
            ))}
          </div>
        ) : <p className="muted">No open items.</p>}
      </div>

      <div className="panel">
        <h3>Active patients <span className="muted" style={{ fontWeight: 500 }}>{patients.length}</span></h3>
        <div style={{ overflowX: "auto" }}>
          <table className="ptable">
            <thead><tr><th>Patient</th><th>Age</th><th>Primary concern</th><th>Intake</th><th className="num">Sessions</th><th className="num">PHQ-9 intake → latest</th><th>Last visit</th><th>Open items</th></tr></thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} onClick={() => router.push(`/patients/${p.id}`)}>
                  <td><Link href={`/patients/${p.id}`} style={{ color: "var(--ink)", fontWeight: 700, textDecoration: "none" }}>{p.name}</Link> <span className="mono muted">{p.id}</span></td>
                  <td>{p.age}</td><td>{p.concern}</td><td>{fmtDate(p.intake)}</td><td className="num">{p.sessions}</td>
                  <td className="num">{p.phqIntake ?? "—"} → {p.phqLatest ?? "—"}</td><td>{p.lastVisit ? fmtDate(p.lastVisit) : "—"}</td>
                  <td>{p.openItems ? <span className="chip c-review">{p.openItems}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {node}
    </>
  );
}
