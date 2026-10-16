"use client";

import Link from "next/link";
import { PhqChart } from "./Charts";
import { PriorityChip } from "./ui";
import { fmtDate, fmtDateY, phqSeverity } from "@/lib/format";

const SST: Record<string, string> = { A: "Attended", NS: "No-show", LC: "Late cancel", RS: "Rescheduled" };
const EVLABEL: Record<string, string> = {
  "Positive risk screen": "Positive suicide-risk screen", "Care plan": "Care plan documented", "Care plan review": "Care plan review",
  "Physical health concern": "Physical health concern", "Elder abuse / neglect concern": "Elder abuse / neglect concern",
};
const RESOLVED_TEXT: Record<string, string> = {
  "Positive risk screen": "Safety plan completed", "Physical health concern": "Referred to PCP",
  "Elder abuse / neglect concern": "Safety assessment and APS report",
};

export default function PatientView({ p, therapist, flags }: { p: any; therapist: any; flags: any[] }) {
  const latest = (code: string) => { const a = p.a.filter((x: any[]) => x[1] === code); return a.length ? a[a.length - 1] : null; };
  const phq = p.a.filter((x: any[]) => x[1] === "PHQ");
  const base = phq.length ? phq[0][2] : null, last = phq.length ? phq[phq.length - 1][2] : null;
  const gds = latest("GDS"), mc = latest("MC"), gad = latest("GAD");
  const attended = p.s.filter((s: any[]) => s[1] === "A").length;
  const events = [...p.e].reverse();
  const sessions = [...p.s].reverse().slice(0, 14);

  return (
    <>
      <div className="crumbs-bar"><Link href="/">Dashboard</Link><span>/</span><Link href={`/therapists/${therapist.id}`}>{therapist.name}</Link><span>/</span><span>{p.name}</span></div>
      <div className="dh">
        <h2>{p.name}</h2><span className="mono muted">{p.id}</span>
        <span className="tag">{p.status}{p.discharge ? ` · ${p.discharge_reason} ${fmtDate(p.discharge)}` : ""}</span>
      </div>
      <div className="facts">
        <span><b>{p.age}</b> · {p.sex === "F" ? "Female" : "Male"}</span><span>{p.concern}</span>
        <span>Therapist <Link className="linkish" href={`/therapists/${therapist.id}`}>{therapist.name}</Link></span>
        <span>{p.alone ? "Lives alone" : "Lives with others"}</span><span>{p.caregiver ? "Caregiver involved" : "No caregiver on file"}</span>
        <span>{p.modality} sessions</span><span>Intake <b>{fmtDateY(p.intake)}</b></span>
      </div>

      {flags.length > 0 && (
        <div className="panel">
          <h3>Open items</h3>
          {flags.map((f) => (
            <div key={f.flag + f.since} style={{ display: "grid", gap: 3, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <div><PriorityChip p={f.priority} /> <b>{f.flag}</b></div>
              <div>{f.detail}</div>
              <div className="ink2"><b>Next step:</b> {f.recommended_action} · Owner: {f.owner}</div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <h3>PHQ-9 over time
          <span className="r legend" style={{ margin: 0 }}>
            <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="var(--series)" /></svg> PHQ-9</span>
            <span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--mark-crit)" strokeWidth="2" /></svg> Positive risk screen</span>
          </span>
        </h3>
        <PhqChart assessments={p.a} />
      </div>

      <div className="panel">
        <h3>Latest screens</h3>
        <div className="kv">
          <div><span>PHQ-9 (depression)</span><b>{last ?? "—"}{last != null ? ` · ${phqSeverity(last)}` : ""}</b></div>
          <div><span>PHQ-9 at intake</span><b>{base ?? "—"}</b></div>
          <div><span>GAD-7 (anxiety)</span><b>{gad ? gad[2] : "—"}</b></div>
          <div><span>GDS-15 (late-life depression)</span><b>{gds ? `${gds[2]} / 15` : "Not done"}</b></div>
          <div><span>Mini-Cog (cognition)</span><b>{mc ? `${mc[2]} / 5${mc[2] < 3 ? " · positive screen" : ""}` : "Not done"}</b></div>
          <div><span>Sessions attended</span><b>{attended}</b></div>
        </div>
      </div>

      <div className="panel">
        <h3>Care events</h3>
        {events.length ? (
          <ul className="timeline">
            {events.map((e: any[], i: number) => (
              <li key={i}>
                <span className="d">{fmtDateY(e[1])}</span>
                <span>
                  <b>{EVLABEL[e[0]] || e[0]}</b>{e[2] && !e[0].startsWith("Care plan") ? ` · ${e[2]}` : ""}
                  {RESOLVED_TEXT[e[0]] && (
                    <><br />{e[3]
                      ? <span className="ink2">{RESOLVED_TEXT[e[0]]} {fmtDate(e[3])}{e[3] === e[1] ? " (same day)" : ""}</span>
                      : <span style={{ color: "var(--crit)", fontWeight: 600 }}>Not yet resolved</span>}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No care events.</p>}
      </div>

      <div className="panel">
        <h3>Recent sessions</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="ptable">
            <thead><tr><th>Date</th><th>Status</th><th>CPT</th><th className="num">Minutes</th><th>Note signed</th></tr></thead>
            <tbody>
              {sessions.map((s: any[], i: number) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td>{fmtDateY(s[0])}</td>
                  <td>{SST[s[1]]}{s[2] ? ` · ${String(s[2]).toLowerCase()}` : ""}</td>
                  <td className="mono">{s[3] || ""}</td>
                  <td className="num">{s[4] || ""}</td>
                  <td>{s[5] == null ? (s[1] === "A" ? <span style={{ color: "var(--crit)" }}>Not signed</span> : "")
                    : s[5] <= 48 ? `${s[5]}h` : <span style={{ color: "var(--crit)", fontWeight: 600 }}>{s[5]}h</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
