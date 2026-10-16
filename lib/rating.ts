// Scorecard rating and alert logic, shared by every page.
//
// The daily pipeline (pipeline/compute.py) rates everything with the default
// thresholds in config/rules.json. The app re-runs the same rules in the
// browser so a quality lead can try different thresholds on the Rules page
// and see the effect immediately. Keep the two in sync.

import rules from "@/config/rules.json";
import { fmtDate, monthName, parseD, pct, DAY_MS } from "./format";

export type MetricStatus = "meets" | "watch" | "below" | "insufficient" | "context";
export type Overall = "Needs attention" | "Watch" | "On track" | "Excelling" | "Too early to rate";
export type Thresholds = {
  metrics: Record<string, { target: number; flag: number }>;
  provider: { notes: number; claims: number; pc7: number; pc28: number; ramp: number; minN: number };
};

export const METRIC_DEFS: any[] = (rules as any).metrics;
export const MDEF: Record<string, any> = Object.fromEntries(METRIC_DEFS.map((m) => [m.id, m]));
export const SCORED: string[] = METRIC_DEFS.filter((m) => m.direction !== "context").map((m) => m.id);
export const SAFETY: string[] = METRIC_DEFS.filter((m) => m.safety).map((m) => m.id);
export const DOMAINS = ["Process", "Clinical outcomes", "Access", "Documentation"];
export const SHORT: Record<string, string> = {
  intake_assessment: "Intake assess.", care_plan: "Care plan by s2", geriatric_screen: "Geri screen",
  followup_assessment: "Re-measured 60d", improvement: "Improved", remission: "Remission 6 mo",
  safety_response: "Same-day safety plan", pcp_referral: "PCP referral 7d", early_dropout: "Early dropout",
  provider_cancel: "Provider cancels", provider_resched: "Provider resched.", notes_48h: "Notes 48h", claims_first_pass: "Claims 1st pass",
};

export function defaultThresholds(): Thresholds {
  const pa = (rules as any).provider_alerts;
  const metrics: Thresholds["metrics"] = {};
  METRIC_DEFS.forEach((d) => { if (d.direction !== "context") metrics[d.id] = { target: d.target, flag: d.flag }; });
  return {
    metrics,
    provider: {
      notes: pa.notes_48h_min, claims: pa.claims_first_pass_min, pc7: pa.provider_cancels_last_week,
      pc28: pa.provider_cancel_rate_4wk_max, ramp: pa.new_hire_ramp_days, minN: pa.min_sessions,
    },
  };
}

export function cmp(th: Thresholds, mid: string, v: number): MetricStatus {
  const d = MDEF[mid], t = th.metrics[mid];
  if (d.direction === "higher") { if (v >= t.target - 1e-9) return "meets"; return v < t.flag - 1e-9 ? "below" : "watch"; }
  if (v <= t.target + 1e-9) return "meets";
  return v > t.flag + 1e-9 ? "below" : "watch";
}

export function statusOf(th: Thresholds, mid: string, value: number | null, den: number | null): MetricStatus {
  const d = MDEF[mid];
  if (!d || d.direction === "context") return "context";
  if (value == null || den == null || den < d.min_n) return "insufficient";
  return cmp(th, mid, value);
}

export function overallOf(st: Record<string, MetricStatus>): Overall {
  const below = SCORED.filter((k) => st[k] === "below");
  const watch = SCORED.filter((k) => st[k] === "watch");
  const ins = SCORED.filter((k) => st[k] === "insufficient");
  if (ins.length >= 4) return "Too early to rate";
  if (below.some((k) => SAFETY.includes(k)) || below.length >= 2) return "Needs attention";
  if (below.length === 1 || watch.length >= 3) return "Watch";
  if (!below.length && watch.length <= 1 && st.improvement === "meets" && st.remission === "meets") return "Excelling";
  return "On track";
}

/** Percent that shows one decimal when rounding would hide why a value missed a line (94.7% vs a 95% target). */
export function pctS(th: Thresholds, mid: string, v: number | null, s: MetricStatus) {
  if (v == null) return "—";
  const t = th.metrics[mid];
  if (!t) return pct(v);
  const r = Math.round(v * 100);
  if ((s !== "meets" && r === Math.round(t.target * 100)) || ((s === "below" || s === "watch") && r === Math.round(t.flag * 100)))
    return (v * 100).toFixed(1) + "%";
  return r + "%";
}

export function targetText(th: Thresholds, mid: string) {
  const d = MDEF[mid], t = th.metrics[mid];
  const hi = d.direction === "higher";
  return `${hi ? "Target ≥ " : "Target ≤ "}${pct(t.target)} · flag ${hi ? "< " : "> "}${pct(t.flag)}`;
}

export type Rated = { t: any; st: Record<string, MetricStatus>; overall: Overall };
export function rateTherapists(th: Thresholds, therapists: any[]): Rated[] {
  return therapists.map((t) => {
    const st: Record<string, MetricStatus> = {};
    SCORED.forEach((k) => (st[k] = statusOf(th, k, t.metrics[k].value, t.metrics[k].den)));
    return { t, st, overall: overallOf(st) };
  });
}

export function reasons(r: Rated) {
  return SCORED.filter((k) => r.st[k] === "below").map((k) => `${MDEF[k].label} ${pct(r.t.metrics[k].value)}`)
    .concat(SCORED.filter((k) => r.st[k] === "watch").map((k) => `${MDEF[k].label} ${pct(r.t.metrics[k].value)} (watch)`));
}

export const OVERALL_ORDER: Record<Overall, number> = { "Needs attention": 0, Watch: 1, "On track": 2, "Too early to rate": 3, Excelling: 4 };

/* ---------- Weekly provider follow-ups (Monday digest) ---------- */
export type ProviderAlert = { tid: string; cat: "Rev cycle" | "Access"; title: string; detail: string };
export function providerAlerts(th: Thresholds, summary: any) {
  const out: ProviderAlert[] = [], suppressed: { tid: string; reason: string }[] = [];
  const pv = th.provider;
  summary.therapists.forEach((t: any) => {
    const s = summary.notifications.provider_signals[t.id];
    if (s.days_since_hire < pv.ramp) {
      suppressed.push({ tid: t.id, reason: `New hire (${s.days_since_hire} days). Performance alerts start at day ${pv.ramp}; patient-safety alerts still fire.` });
      return;
    }
    if (s.notes_n >= pv.minN && s.notes_ok / s.notes_n < pv.notes)
      out.push({ tid: t.id, cat: "Rev cycle", title: "Notes signed late", detail: `${pct(s.notes_ok / s.notes_n)} of notes signed within 48 hours over the last 4 weeks (${s.notes_n - s.notes_ok} of ${s.notes_n} late). Late notes hold up claims.` });
    if (s.claims_n >= pv.minN && s.claims_ok / s.claims_n < pv.claims)
      out.push({ tid: t.id, cat: "Rev cycle", title: "Claim denials", detail: `${pct(s.claims_ok / s.claims_n)} of claims accepted first pass over the last 4 weeks (${s.claims_n - s.claims_ok} denied). Most common reason: ${s.top_denial}.` });
    if (s.offered < s.contracted)
      out.push({ tid: t.id, cat: "Access", title: "Fewer hours offered than contracted", detail: `${s.offered} hours open for booking next week vs. ${s.contracted} contracted.` });
    const r28 = s.sched28 ? s.pc28 / s.sched28 : 0;
    if (s.pc7 >= pv.pc7 || r28 > pv.pc28)
      out.push({ tid: t.id, cat: "Access", title: "Provider late cancels / no-shows", detail: `${s.pc7} in the last week; ${s.pc28} of ${s.sched28} scheduled sessions (${pct(r28)}) over the last 4 weeks.` });
  });
  return { out, suppressed };
}

/* ---------- Month-end scorecard changes and goal shoutouts ---------- */
export function monthStatuses(th: Thresholds, summary: any, tid: string, i: number) {
  const tr = summary.trends.therapists[tid], st: Record<string, MetricStatus> = {};
  SCORED.forEach((k) => { const v = tr[k] ? tr[k][i] : null; st[k] = v == null ? "insufficient" : cmp(th, k, v); });
  return st;
}
const SLABEL: Record<MetricStatus, string> = { meets: "Meets", watch: "Watch", below: "Past flag", insufficient: "Not enough data", context: "Context" };
export const statusLabel = (s: MetricStatus) => SLABEL[s];

export function scorecardChanges(th: Thresholds, summary: any) {
  const months: string[] = summary.trends.months;
  const asOf = parseD(summary.meta.as_of);
  const closes = months.map((_, i) => i).filter((i) => i < months.length - 1 && parseD(months[i]) < asOf);
  const [i3, i2, i1] = closes.slice(-3);
  const alerts: { tid: string; title: string; detail: string }[] = [];
  const shout: { tid: string; kind: string; title: string; detail: string; patients?: string[] }[] = [];
  summary.therapists.forEach((t: any) => {
    const s3 = monthStatuses(th, summary, t.id, i3), s2 = monthStatuses(th, summary, t.id, i2), s1 = monthStatuses(th, summary, t.id, i1);
    const newRamp = (parseD(months[i1]).getTime() - parseD(t.hire_date).getTime()) / DAY_MS < th.provider.ramp + 60;
    SCORED.forEach((k) => {
      const lbl = MDEF[k].label, v1 = summary.trends.therapists[t.id][k][i1];
      if (s1[k] === "below" && s2[k] !== "below" && !newRamp)
        alerts.push({ tid: t.id, title: `${lbl} fell past its flag line`, detail: `${pct(v1)} at the ${fmtDate(months[i1])} close (was ${SLABEL[s2[k]].toLowerCase()} on ${fmtDate(months[i2])}). ${targetText(th, k)}.` });
      if (s1[k] === "meets" && s2[k] === "meets" && (s3[k] === "watch" || s3[k] === "below"))
        shout.push({ tid: t.id, kind: "Goal met", title: `Hit goal: ${lbl}`, detail: `Met target at the ${fmtDate(months[i2])} and ${fmtDate(months[i1])} closes, after missing it in ${monthName(months[i3])}. Now ${pct(v1)}.` });
    });
    const o3 = overallOf(s3), o2 = overallOf(s2), o1 = overallOf(s1);
    if (o1 === "Excelling" && o2 === "Excelling" && o3 !== "Excelling")
      shout.push({ tid: t.id, kind: "Goal met", title: "Overall rating: Excelling", detail: `Rated Excelling at the last two month-end closes (was ${o3} in ${monthName(months[i3])}).` });
  });
  return { alerts, shout, close: months[i1] };
}

/* ---------- Draft 1:1 agenda ---------- */
export function agendaFor(th: Thresholds, r: Rated, summary: any, patientNames: Record<string, string>) {
  const t = r.t, m = t.metrics, lines: string[] = [];
  const prov = providerAlerts(th, summary).out.filter((a) => a.tid === t.id);
  const flags = summary.case_flags.filter((f: any) => f.therapist_id === t.id);
  const urgent = flags.filter((f: any) => f.priority === "Urgent");
  lines.push(`1:1 with ${t.name.split(" ")[0]} · week of ${fmtDate(summary.notifications.monday_digest.date)}`, "");
  const wins = SCORED.filter((k) => r.st[k] === "meets" && ["improvement", "remission", "safety_response", "notes_48h", "followup_assessment"].includes(k));
  if (wins.length) lines.push("Start with what’s working: " + wins.map((k) => `${MDEF[k].label.toLowerCase()} ${pct(m[k].value)}`).join(", ") + ".");
  if (urgent.length) { lines.push("", "Patient safety (today):"); urgent.forEach((f: any) => lines.push(`• ${patientNames[f.patient_id] || f.patient_id}: ${f.detail}`)); }
  const below = SCORED.filter((k) => r.st[k] === "below"), watch = SCORED.filter((k) => r.st[k] === "watch");
  if (below.length || watch.length || prov.length) {
    lines.push("", "Scorecard and operations:");
    below.forEach((k) => lines.push(`• ${MDEF[k].label}: ${pct(m[k].value)} (${m[k].num} of ${m[k].den}). ${targetText(th, k)}.`));
    watch.forEach((k) => lines.push(`• Keep an eye on ${MDEF[k].label.toLowerCase()}: ${pct(m[k].value)}.`));
    prov.forEach((a) => lines.push(`• ${a.title}: ${a.detail}`));
  }
  const rv = flags.filter((f: any) => f.priority !== "Urgent");
  if (rv.length) {
    const c: Record<string, number> = {};
    rv.forEach((f: any) => (c[f.flag] = (c[f.flag] || 0) + 1));
    lines.push("", "Patients to review together:");
    Object.entries(c).forEach(([k, n]) => lines.push(`• ${k}: ${n}`));
  }
  lines.push("", "Agree on: one change for this week, and what support they need from you.");
  return lines.join("\n");
}
