"use client";

import { useEffect, useState } from "react";
import { useThresholds, useToast } from "./Providers";
import { DOMAINS, METRIC_DEFS } from "@/lib/rating";

/** Number input that commits valid values as you type and resyncs on reset. */
function NumInput({ id, value, dflt, pctMode, unit, min = 0, max, onCommit, label }: {
  id: string; value: number; dflt: number; pctMode?: boolean; unit: string; min?: number; max?: number; onCommit: (v: number) => void; label: string;
}) {
  const shown = pctMode ? Math.round(value * 100) : value;
  const [s, setS] = useState(String(shown));
  useEffect(() => setS(String(shown)), [shown]);
  return (
    <span className="thr">
      <input id={id} type="number" inputMode="decimal" step={1} min={min} max={max ?? (pctMode ? 100 : undefined)} value={s} aria-label={label}
        className={Math.abs(value - dflt) > 1e-9 ? "changed" : ""}
        onChange={(e) => {
          setS(e.target.value);
          const v = parseFloat(e.target.value);
          if (isNaN(v)) return;
          const c = Math.max(min, pctMode ? Math.min(100, v) : v);
          onCommit(pctMode ? c / 100 : Math.round(c));
        }} />
      <span className="u">{unit}</span>
    </span>
  );
}

/* ---------- What quality BH care means at Sailor ---------- */
function QualityApproach() {
  return (
    <section className="block quality">
      <h2>What quality BH care means at Sailor</h2>
      <div className="qrows">
        <div className="qrow">
          <span className="qlabel">Foundation</span>
          <p>
            Every BH quality program rests on <b>operational processes</b> (the right actions happen),{" "}
            <b>clinical improvement</b> (patients get better) and <b>access</b> (patients can get care when they need it).
          </p>
        </div>
        <div className="qrow">
          <span className="qlabel">For seniors</span>
          <p>
            We add <b>close coordination with primary care</b> for chronic physical conditions, <b>robust safety escalation</b> given
            the high suicide rate in late life, and <b>age-appropriate assessment</b> (GDS-15 geriatric depression screen and Mini-Cog).
          </p>
        </div>
      </div>
    </section>
  );
}

const TIER_CLASS: Record<string, string> ={ Urgent: "c-urgent", High: "c-high", Review: "c-review", Recognition: "c-recog" };

export default function RulesView({ rules }: { rules: any }) {
  const { th, defaults, setMetric, setProvider, reset, changed } = useThresholds();
  const { toast, node } = useToast();
  const pv = th.provider, dp = defaults.provider;

  const ctrl: Record<string, React.ReactNode> = {
    "Rev cycle": <>Notes in 48h below <NumInput id="pv-notes" label="Notes threshold" value={pv.notes} dflt={dp.notes} pctMode unit="%" onCommit={(v) => setProvider("notes", v)} />{" "}
      or claims first pass below <NumInput id="pv-claims" label="Claims threshold" value={pv.claims} dflt={dp.claims} pctMode unit="%" onCommit={(v) => setProvider("claims", v)} />, trailing 4 weeks</>,
    Access: <>Hours offered for next week below contracted; or <NumInput id="pv-pc7" label="Cancels last week" value={pv.pc7} dflt={dp.pc7} unit="or more" onCommit={(v) => setProvider("pc7", v)} />{" "}
      provider late cancels / no-shows in the last week, or above <NumInput id="pv-pc28" label="Cancel rate" value={pv.pc28} dflt={dp.pc28} pctMode unit="%" onCommit={(v) => setProvider("pc28", v)} /> over 4 weeks</>,
  };

  return (
    <>
      <QualityApproach />

      <section className="block">
        <div className="sec-head"><div><div className="eyebrow">Scorecard</div><h2>Scorecard metrics and thresholds</h2></div>
          <div className="right"><span className="sub">Target = meets goal. Flag line = flagged for follow-up.</span></div></div>
        <div className="savebar">
          <span>{changed ? "You’ve changed some thresholds. The dashboard reflects your edits. Saved in this browser only." : "Edit any threshold and the dashboard updates right away. Edits are saved in this browser only."}</span>
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={() => { reset(); toast("Thresholds reset to defaults"); }}>Reset to defaults</button>
        </div>
        {DOMAINS.map((dn) => (
          <div key={dn}>
            <div className="mdom">{dn}</div>
            <div className="tablebox" style={{ overflow: "visible" }}>
              {METRIC_DEFS.filter((m) => m.domain === dn && m.direction !== "context").map((m) => {
                const t = th.metrics[m.id], d0 = defaults.metrics[m.id], hi = m.direction === "higher";
                const bad = hi ? t.flag > t.target : t.flag < t.target;
                return (
                  <div className="mrule" key={m.id}>
                    <div>
                      <div className="lbl">{m.label} {m.safety && <span className="chip c-urgent" style={{ marginLeft: 4 }}>Patient safety</span>}</div>
                      <div className="def">{m.definition}</div>
                      <div className="calc">Numerator: {m.numerator}. Denominator: {m.denominator}. Window: {m.window}. Minimum {m.min_n} to rate.</div>
                    </div>
                    <div className="ctrl">
                      <label htmlFor={`mt-${m.id}`}>Target ({hi ? "at least" : "at most"})
                        <NumInput id={`mt-${m.id}`} label={`${m.label} target`} value={t.target} dflt={d0.target} pctMode unit="%" onCommit={(v) => setMetric(m.id, "target", v)} /></label>
                      <label htmlFor={`mf-${m.id}`}>Flag line ({hi ? "below" : "above"})
                        <NumInput id={`mf-${m.id}`} label={`${m.label} flag line`} value={t.flag} dflt={d0.flag} pctMode unit="%" onCommit={(v) => setMetric(m.id, "flag", v)} /></label>
                    </div>
                    {bad && <div className="warnmsg">The flag line should be {hi ? "at or below" : "at or above"} the target.</div>}
                  </div>
                );
              })}
              {METRIC_DEFS.filter((m) => m.domain === dn && m.direction === "context").map((m) => (
                <div className="mrule" key={m.id}>
                  <div><div className="lbl">{m.label}</div><div className="def">{m.definition}</div></div>
                  <div className="ctrl"><span className="chip c-context">Context · not rated</span></div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="panel" style={{ marginTop: 18 }}>
          <h3>Overall rating</h3>
          <div className="kv" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))" }}>
            <div><span className="pill o-needs">Needs attention</span><b>Any patient-safety metric past its flag line, or two or more metrics past their flag lines.</b></div>
            <div><span className="pill o-watch">Watch</span><b>One metric past its flag line, or three or more between target and flag line.</b></div>
            <div><span className="pill o-excel">Excelling</span><b>Nothing past a flag line, at most one in between, and both improvement and remission at target.</b></div>
            <div><span className="pill o-ontrack">On track</span><b>Everything else.</b></div>
            <div><span className="pill o-early">Too early to rate</span><b>Four or more metrics without enough patients to judge.</b></div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="sec-head"><div><div className="eyebrow">Notifications</div><h2>Notifications and Associated Next Steps</h2></div></div>
        <p className="cadence">
          <span><b>Daily:</b> urgent patient-safety escalations only</span>
          <span><b>Every Monday:</b> one digest for the whole pod</span>
          <span><b>Month-end:</b> scorecard changes, in the next Monday digest</span>
        </p>
        <div className="tablebox">
          <table className="rtable">
            <thead><tr><th>Tier</th><th>Cadence</th><th>Category</th><th>Trigger</th><th>Next step</th><th>Owner</th></tr></thead>
            <tbody>
              {rules.notification_rules.map((r: any) => (
                <tr key={r.category + r.trigger}>
                  <td><span className={`chip ${TIER_CLASS[r.tier]}`}>{r.tier}</span></td><td>{r.cadence}</td><td><b>{r.category}</b></td>
                  <td className="trig">{ctrl[r.category] || r.trigger}</td><td>{r.action}</td><td>{r.owner}</td>
                </tr>
              ))}
              <tr>
                <td><span className="chip c-routine">All</span></td><td>—</td><td><b>New-hire ramp</b></td>
                <td className="trig">No provider performance alerts for the first <NumInput id="pv-ramp" label="Ramp days" value={pv.ramp} dflt={dp.ramp} unit="days" onCommit={(v) => setProvider("ramp", v)} /></td>
                <td>Patient-safety alerts still fire</td><td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <div className="sec-head"><div><div className="eyebrow">Scope</div><h2>Not alerted on, on purpose</h2></div></div>
        <div className="offlist">
          <div><b>Patient no-shows on the therapist’s record</b><span className="ink2">Older adults miss sessions for health, hearing, technology and transport reasons. Patient no-shows route to care coordination for outreach; only provider-driven cancels count against a therapist.</span></div>
          <div><b>Provider fill rate / productivity</b><span className="ink2">The percent of bookable time filled with appointments. Shown on the dashboard for capacity planning, but not scored or alerted on: pushing volume with a complex older population works against quality.</span></div>
        </div>
      </section>
      {node}
    </>
  );
}
