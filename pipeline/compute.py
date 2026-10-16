"""
Pod Quality Console -- daily compute engine.

Reads the day's raw exports (data/raw/*.csv, contract in pipeline/SCHEMA.md)
and the scorecard / notification rules (config/rules.json), and writes what
the web app shows (data/computed/):

  summary.json    scorecards, pod KPIs, 12-month trends, case flags,
                  daily urgent list and Monday digest
  patients.json   per-patient timelines for the chart view
  case_flags.csv  the open review queue, for ops use

Run every weekday morning after the exports land (see .github/workflows/daily.yml):
  python3 pipeline/compute.py [--as-of YYYY-MM-DD]
Defaults to the as_of date in data/raw/export_meta.json, else today.
"""

import argparse
import json
import math
import os
from datetime import date, datetime, timedelta

import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW_DIR = os.path.join(ROOT, "data", "raw")
OUT_DIR = os.path.join(ROOT, "data", "computed")
RULES = json.load(open(os.path.join(ROOT, "config", "rules.json")))

_ap = argparse.ArgumentParser()
_ap.add_argument("--as-of", help="compute as of this date (YYYY-MM-DD)")
_args, _ = _ap.parse_known_args()
_meta_path = os.path.join(RAW_DIR, "export_meta.json")
_meta = json.load(open(_meta_path)) if os.path.exists(_meta_path) else {}
AS_OF = date.fromisoformat(_args.as_of or _meta.get("as_of") or date.today().isoformat())

METRICS = RULES["metrics"]
METRIC_BY_ID = {m["id"]: m for m in METRICS}
PA = RULES["provider_alerts"]
RAMP_DAYS = PA["new_hire_ramp_days"]
NOTIFICATION_RULES = RULES["notification_rules"]
GLOBAL_RULES = RULES["global_rules"]

# ---------------------------------------------------------------------------
# 1. Load raw exports
# ---------------------------------------------------------------------------
def _csv(name, **kw):
    return pd.read_csv(os.path.join(RAW_DIR, name), **kw)


_T = _csv("therapists.csv")
THERAPISTS = [dict(id=r.therapist_id, name=r.name, credential=r.credential, hire_date=r.hire_date,
                   contracted_hours=float(r.contracted_hours)) for r in _T.itertuples()]
SCHED = _csv("schedule.csv", parse_dates=["week_start"])
P = _csv("patients.csv")
S = _csv("sessions.csv", dtype={"cpt": str})
A = _csv("assessments.csv")
E = _csv("care_events.csv")
C = _csv("claims.csv", dtype={"cpt": str})
for df, cols in [(P, ["intake_date", "discharge_date"]), (S, ["date"]), (A, ["date"]),
                 (E, ["date", "resolved_date"]), (C, ["submitted"])]:
    for c in cols:
        if c in df:
            df[c] = pd.to_datetime(df[c])
S["note_signed_at"] = pd.to_datetime(S["note_signed_at"])
S["start"] = pd.to_datetime(S["start"])
S["rescheduled_from_provider"] = S["rescheduled_from_provider"].astype(str).str.lower().eq("true")


def offered_hours(tid, d):
    """Bookable hours the therapist opened for the week containing date d (0 if none)."""
    d = pd.Timestamp(d)
    wk = d - pd.Timedelta(days=d.weekday())
    row = SCHED[(SCHED.therapist_id == tid) & (SCHED.week_start == wk.normalize())]
    return float(row.offered_hours.iloc[0]) if len(row) else 0.0


ATT = S[S.status == "Attended"].copy()
PHQ = A[A.instrument == "PHQ-9"].copy()


def rate(num, den):
    return (num / den) if den else None


def patient_session_n(as_of):
    att = ATT[ATT.date <= as_of].sort_values("date")
    return att


def compute_metrics(as_of, tid=None):
    """Return {metric_id: dict(value, num, den)} for one therapist (or pod if tid None)."""
    as_of = pd.Timestamp(as_of)
    sel = (lambda df: df) if tid is None else (lambda df: df[df.therapist_id == tid])
    p_ = sel(P[P.intake_date <= as_of])
    att = sel(ATT[ATT.date <= as_of])
    phq = sel(PHQ[PHQ.date <= as_of])
    a_ = sel(A[A.date <= as_of])
    e_ = sel(E[E.date <= as_of])
    s_ = sel(S[S.date <= as_of])
    c_ = sel(C[C.submitted <= as_of])
    out = {}

    # session ranks
    att_sorted = att.sort_values(["patient_id", "date", "start"])
    att_sorted = att_sorted.assign(rank=att_sorted.groupby("patient_id").cumcount() + 1)
    s1 = att_sorted[att_sorted["rank"] == 1].set_index("patient_id")["date"]
    s2 = att_sorted[att_sorted["rank"] == 2].set_index("patient_id")["date"]
    n_att = att_sorted.groupby("patient_id").size()
    last_att = att_sorted.groupby("patient_id")["date"].max()

    active = p_[(p_.discharge_date.isna()) | (p_.discharge_date > as_of)]

    # --- intake-based process metrics (intakes 14..180 days ago)
    coh = p_[(p_.intake_date > as_of - pd.Timedelta(days=180)) & (p_.intake_date <= as_of - pd.Timedelta(days=14))]
    coh = coh[coh.patient_id.isin(s1.index)]
    num = den = 0
    for pid in coh.patient_id:
        den += 1
        d1 = s1[pid]
        got = a_[(a_.patient_id == pid) & (a_.date == d1)].instrument
        if {"PHQ-9", "GAD-7", "Risk screen (C-SSRS)"} <= set(got):
            num += 1
    out["intake_assessment"] = dict(value=rate(num, den), num=num, den=den)

    coh2 = coh[coh.patient_id.isin(s2.index)]
    num_cp = num_g = den2 = 0
    cp = e_[e_.type == "Care plan"].groupby("patient_id")["date"].min()
    gds = a_[a_.instrument == "GDS-15"].groupby("patient_id")["date"].min()
    mc = a_[a_.instrument == "Mini-Cog"].groupby("patient_id")["date"].min()
    for pid in coh2.patient_id:
        den2 += 1
        if pid in cp.index and cp[pid] <= s2[pid]:
            num_cp += 1
        if pid in gds.index and pid in mc.index and gds[pid] <= s2[pid] and mc[pid] <= s2[pid]:
            num_g += 1
    out["care_plan"] = dict(value=rate(num_cp, den2), num=num_cp, den=den2)
    out["geriatric_screen"] = dict(value=rate(num_g, den2), num=num_g, den=den2)

    # --- follow-up assessment within 60 days (active, in care 60+ days)
    act60 = active[active.intake_date <= as_of - pd.Timedelta(days=60)]
    last_phq = phq.groupby("patient_id")["date"].max()
    num = sum(1 for pid in act60.patient_id if pid in last_phq.index and last_phq[pid] > as_of - pd.Timedelta(days=60))
    out["followup_assessment"] = dict(value=rate(num, len(act60)), num=num, den=len(act60))

    # --- improvement since intake
    phq_sorted = phq.sort_values("date")
    first_phq = phq_sorted.groupby("patient_id").first()
    lastp = phq_sorted.groupby("patient_id").last()
    seen12 = set(att[att.date > as_of - pd.Timedelta(days=365)].patient_id)
    num = den = 0
    for pid in seen12:
        if pid not in first_phq.index:
            continue
        b = first_phq.loc[pid]
        pi = P.loc[P.patient_id == pid].iloc[0]
        if b["date"] != s1.get(pid, pd.NaT) or b["score"] < 10:
            continue  # need a true intake baseline >= 10
        l = lastp.loc[pid]
        if (l["date"] - b["date"]).days < 42:
            continue
        den += 1
        if l["score"] <= b["score"] - 5:
            num += 1
    out["improvement"] = dict(value=rate(num, den), num=num, den=den)

    # --- remission at 6 months (intake 8-14 months ago, baseline >= 10)
    rcoh = p_[(p_.intake_date <= as_of - pd.Timedelta(days=240)) & (p_.intake_date > as_of - pd.Timedelta(days=425))]
    num = den = 0
    for _, pr in rcoh.iterrows():
        pid = pr.patient_id
        if pid not in first_phq.index or pid not in s1.index:
            continue
        b = first_phq.loc[pid]
        if b["date"] != s1[pid] or b["score"] < 10:
            continue
        den += 1
        ps = phq_sorted[phq_sorted.patient_id == pid]
        w = ps[(ps.date >= pr.intake_date + pd.Timedelta(days=120)) & (ps.date <= pr.intake_date + pd.Timedelta(days=240))]
        if len(w):
            if w.iloc[-1]["score"] < 5:
                num += 1
        elif pr.discharge_reason == "Planned discharge" and pd.notna(pr.discharge_date) and pr.discharge_date < pr.intake_date + pd.Timedelta(days=120):
            if ps.iloc[-1]["score"] < 5:
                num += 1
    out["remission"] = dict(value=rate(num, den), num=num, den=den)

    # --- same-day safety plan
    pos = e_[(e_.type == "Positive risk screen") & (e_.date > as_of - pd.Timedelta(days=365))]
    num = int(((pos.resolved_date.notna()) & (pos.resolved_date <= pos.date)).sum())
    out["safety_response"] = dict(value=rate(num, len(pos)), num=num, den=len(pos))

    # --- PCP referral within 7 days
    hc = e_[(e_.type == "Physical health concern") & (e_.date > as_of - pd.Timedelta(days=365)) &
            (e_.date <= as_of - pd.Timedelta(days=7))]
    num = int(((hc.resolved_date.notna()) & (hc.resolved_date <= hc.date + pd.Timedelta(days=7)) &
               (hc.resolved_date <= as_of)).sum())
    out["pcp_referral"] = dict(value=rate(num, len(hc)), num=num, den=len(hc))

    # --- early dropout
    ecoh = p_[(p_.intake_date > as_of - pd.Timedelta(days=365)) & (p_.intake_date <= as_of - pd.Timedelta(days=45))]
    num = den = 0
    for _, pr in ecoh.iterrows():
        pid = pr.patient_id
        if pid not in s1.index:
            continue
        den += 1
        if n_att.get(pid, 0) <= 2 and last_att[pid] <= as_of - pd.Timedelta(days=30) and \
                not (pr.discharge_reason == "Planned discharge" and pd.notna(pr.discharge_date) and pr.discharge_date <= as_of):
            num += 1
    out["early_dropout"] = dict(value=rate(num, den), num=num, den=den)

    # --- access
    s90 = s_[s_.date > as_of - pd.Timedelta(days=90)]
    sched = s90[s90.rescheduled_from_provider == False]
    pc = int(((sched.cancelled_by == "Provider") & (sched.status.isin(["Late cancel", "No-show"]))).sum())
    prs = int(((sched.cancelled_by == "Provider") & (sched.status == "Rescheduled")).sum())
    out["provider_cancel"] = dict(value=rate(pc, len(sched)), num=pc, den=len(sched))
    out["provider_resched"] = dict(value=rate(prs, len(sched)), num=prs, den=len(sched))
    pt = int((sched.cancelled_by == "Patient").sum())
    out["patient_noshow"] = dict(value=rate(pt, len(sched)), num=pt, den=len(sched))

    # capacity
    if tid is None:
        cap = sum(offered_hours(t["id"], as_of) for t in THERAPISTS)
    else:
        cap = offered_hours(tid, as_of)
    a28 = att[att.date > as_of - pd.Timedelta(days=28)]
    filled = a28.minutes.sum() / 60 / 4
    out["available_hours"] = dict(value=float(cap), num=None, den=None)
    out["filled_hours"] = dict(value=round(float(filled), 1), num=None, den=None)
    out["utilization"] = dict(value=rate(filled, cap), num=None, den=None)

    # --- documentation
    a90 = att[(att.date > as_of - pd.Timedelta(days=90)) & (att.date <= as_of - pd.Timedelta(days=2))]
    lag = (a90.note_signed_at - a90.start).dt.total_seconds() / 3600
    signed_ok = int(((lag <= 48 + 1) & a90.note_signed_at.notna() & (a90.note_signed_at <= as_of + pd.Timedelta(hours=20))).sum())
    out["notes_48h"] = dict(value=rate(signed_ok, len(a90)), num=signed_ok, den=len(a90))
    c90 = c_[c_.submitted > as_of - pd.Timedelta(days=90)]
    ok = int((c90.first_pass == "Accepted").sum())
    out["claims_first_pass"] = dict(value=rate(ok, len(c90)), num=ok, den=len(c90))

    # --- context
    out["active_caseload"] = dict(value=int(len(active[active.patient_id.isin(att.patient_id)])), num=None, den=None)
    disc = p_[(p_.discharge_reason == "Planned discharge") & (p_.discharge_date > as_of - pd.Timedelta(days=365)) &
              (p_.discharge_date <= as_of)]
    ep = ((disc.discharge_date - disc.intake_date).dt.days / 7).mean() if len(disc) else None
    out["avg_episode_weeks"] = dict(value=None if ep is None or pd.isna(ep) else round(float(ep), 1), num=None, den=None)
    base = first_phq[first_phq.index.isin(active.patient_id)]["score"]
    out["avg_baseline_phq"] = dict(value=None if not len(base) else round(float(base.mean()), 1), num=None, den=None)
    return out


def metric_status(mid, v):
    m = METRIC_BY_ID[mid]
    if m["direction"] == "context":
        return "context"
    val, den = v["value"], v["den"]
    if val is None or den is None or den < m["min_n"]:
        return "insufficient"
    if m["direction"] == "higher":
        if val >= m["target"] - 1e-9:
            return "meets"
        return "below" if val < m["flag"] - 1e-9 else "watch"
    else:
        if val <= m["target"] + 1e-9:
            return "meets"
        return "below" if val > m["flag"] + 1e-9 else "watch"


def therapist_status(statuses):
    scored = {k: v for k, v in statuses.items() if v not in ("context",)}
    below = [k for k, v in scored.items() if v == "below"]
    watch = [k for k, v in scored.items() if v == "watch"]
    insuff = [k for k, v in scored.items() if v == "insufficient"]
    safety_below = [k for k in below if METRIC_BY_ID[k].get("safety")]
    if len(insuff) >= 4:
        return "Too early to rate"
    if safety_below or len(below) >= 2:
        return "Needs attention"
    if len(below) == 1 or len(watch) >= 3:
        return "Watch"
    if not below and len(watch) <= 1 and scored.get("improvement") == "meets" and scored.get("remission") == "meets":
        return "Excelling"
    return "On track"


# ---------------------------------------------------------------------------
# 6. Patient case flags (the review queue)
# ---------------------------------------------------------------------------
def build_case_flags(as_of):
    as_of = pd.Timestamp(as_of)
    flags = []
    att = ATT[ATT.date <= as_of].sort_values("date")
    last_att = att.groupby("patient_id")["date"].max()
    n_att = att.groupby("patient_id").size()
    phq = PHQ[PHQ.date <= as_of].sort_values("date")
    active = P[(P.intake_date <= as_of) & ((P.discharge_date.isna()) | (P.discharge_date > as_of))]
    active_ids = set(active.patient_id)

    def add(pid, ftype, priority, detail, action, since, owner="Therapist"):
        tid = P.loc[P.patient_id == pid, "therapist_id"].iloc[0]
        days_open = int((as_of - pd.Timestamp(since)).days)
        urgent = priority == "Urgent"
        escalated = urgent and days_open > 2
        flags.append(dict(patient_id=pid, therapist_id=tid, flag=ftype, priority=priority,
                          cadence="Daily" if urgent else "Monday digest", owner=owner, detail=detail,
                          recommended_action=action, since=pd.Timestamp(since).date().isoformat(),
                          days_open=days_open, escalated=escalated,
                          escalation="Open > 48h: escalate to clinical director" if escalated else None))

    def res_by(r):
        """Resolution date as known on as_of (later resolutions don't count yet)."""
        return r.resolved_date if pd.notna(r.resolved_date) and r.resolved_date <= as_of else pd.NaT

    # 1. positive risk screen without same-day safety plan (last 45 days)
    pos = E[(E.type == "Positive risk screen") & (E.date > as_of - pd.Timedelta(days=45)) & (E.date <= as_of)]
    for _, r in pos.iterrows():
        if r.patient_id not in active_ids:
            continue
        rd = res_by(r)
        if pd.isna(rd) or rd > r.date:
            if pd.isna(rd):
                add(r.patient_id, "Positive risk screen, no safety plan", "Urgent",
                    f"Positive suicide-risk screen on {r.date.date():%b %d} ({r.detail.split(';')[0]}); no safety plan on file.",
                    "Reach the therapist today: confirm a same-day safety check-in with the patient, complete and document a safety plan, and consider a psychiatry consult.",
                    r.date, owner="Lead + therapist")
            elif rd > as_of - pd.Timedelta(days=30):
                add(r.patient_id, "Safety plan completed late", "Review",
                    f"Positive risk screen on {r.date.date():%b %d}; safety plan not done until {r.resolved_date.date():%b %d}.",
                    "Discuss in supervision: same-day safety planning is the standard. Confirm the plan is current.",
                    r.date)

    # 2. elder abuse / neglect concern without documented safety assessment / APS report
    ea = E[(E.type == "Elder abuse / neglect concern") & (E.date <= as_of - pd.Timedelta(days=1)) &
           (E.date > as_of - pd.Timedelta(days=60))]
    for _, r in ea.iterrows():
        if r.patient_id in active_ids and pd.isna(res_by(r)):
            add(r.patient_id, "Elder abuse / neglect concern, no report on file", "Urgent",
                f"{r.detail}, disclosed {r.date.date():%b %d}. No safety assessment or Adult Protective Services report documented.",
                "Confirm the patient is safe today, document a safety assessment, and file with Adult Protective Services where state law requires.",
                r.date, owner="Lead + therapist")

    for pid in sorted(active_ids):
        ps = phq[phq.patient_id == pid]
        pinfo = active[active.patient_id == pid].iloc[0]
        # 3. worsening since last assessment
        if len(ps) >= 2:
            last, prev = ps.iloc[-1], ps.iloc[-2]
            if last.date > as_of - pd.Timedelta(days=45) and last.score - prev.score >= 5 and last.score >= 10:
                add(pid, "PHQ-9 worsened", "High",
                    f"PHQ-9 rose from {prev.score} to {last.score} ({prev.date.date():%b %d} to {last.date.date():%b %d}).",
                    "Re-screen for suicide risk at the next visit, bring the case to clinical consultation, and ask about new stressors, health changes or medication changes.",
                    last.date)
        # 4. no response after 12+ weeks
        if len(ps) >= 2:
            b, last = ps.iloc[0], ps.iloc[-1]
            weeks = (as_of - pinfo.intake_date).days / 7
            if b.score >= 10 and weeks >= 12 and last.score >= 10 and last.score > b.score * 0.8 and \
                    last.date > as_of - pd.Timedelta(days=60) and not (last.score - ps.iloc[-2].score >= 5):
                add(pid, "Not improving after 12+ weeks", "Review",
                    f"PHQ-9 {b.score} at intake, {last.score} now after {int(weeks)} weeks.",
                    "Bring to case consultation: revisit the care plan and modality, check engagement, and consider a PCP or psychiatry referral for medication evaluation.",
                    last.date)
        # 5. disengaged
        if pid in last_att.index:
            gap = (as_of - last_att[pid]).days
            if gap >= 30:
                add(pid, "Disengaged: no visit in 30+ days", "Review",
                    f"Last attended session {last_att[pid].date():%b %d} ({gap} days ago); {n_att[pid]} sessions total.",
                    "Care coordinator outreach this week: check for barriers (tech, hearing, transport, health), contact the caregiver if consented, and offer phone sessions.",
                    last_att[pid], owner="Care coordination")
        # 6. overdue outcome measure
        if pinfo.intake_date <= as_of - pd.Timedelta(days=60) and pid in last_att.index and \
                (as_of - last_att[pid]).days < 30:
            lp = ps.date.max() if len(ps) else None
            if lp is None or lp <= as_of - pd.Timedelta(days=60):
                add(pid, "Outcome measure overdue", "Routine",
                    "No PHQ-9 in the last 60 days." if lp is not None else "No PHQ-9 on file.",
                    "Administer PHQ-9 at the next session.",
                    lp if lp is not None else pinfo.intake_date)
        # 7. intake incomplete
        if n_att.get(pid, 0) >= 2 and pinfo.intake_date <= as_of - pd.Timedelta(days=14):
            pe = E[(E.patient_id == pid) & (E.type == "Care plan") & (E.date <= as_of)]
            pa = A[(A.patient_id == pid) & (A.date <= as_of)]
            missing = []
            if not len(pe):
                missing.append("care plan")
            if not (pa.instrument == "GDS-15").any():
                missing.append("GDS-15")
            if not (pa.instrument == "Mini-Cog").any():
                missing.append("Mini-Cog")
            if missing and pinfo.intake_date > as_of - pd.Timedelta(days=75):
                add(pid, "Intake incomplete", "Routine",
                    "Missing: " + ", ".join(missing) + ".",
                    "Complete the missing intake items at the next session.",
                    pinfo.intake_date + pd.Timedelta(days=14))

    # 8. physical health concern not referred to PCP
    #    red-flag concerns (falls, confusion, medication reactions): after 1 day; others: after 7 days
    RED = {"Recent fall", "Possible medication side effects", "Memory changes noticed"}
    hc = E[(E.type == "Physical health concern") & (E.date <= as_of - pd.Timedelta(days=1)) &
           (E.date > as_of - pd.Timedelta(days=60))]
    for _, r in hc.iterrows():
        if r.patient_id not in active_ids or pd.notna(res_by(r)):
            continue
        red = r.detail in RED
        if not red and r.date > as_of - pd.Timedelta(days=7):
            continue
        add(r.patient_id, "Health concern not sent to PCP", "Urgent",
            f"{r.detail} raised {r.date.date():%b %d}; no PCP referral yet." +
            (" Red-flag concern for an older adult." if red else ""),
            "Send to the PCP today with a short summary; ask the PCP team to confirm receipt.",
            r.date, owner="Therapist (lead verifies)")

    return flags


# ---------------------------------------------------------------------------
# 6b. Provider-level alerts, scorecard changes, shoutouts, notification bundles
# ---------------------------------------------------------------------------
def provider_signals(as_of):
    """Raw weekly provider signals for every therapist (lets the app re-run alerts at any threshold)."""
    as_of = pd.Timestamp(as_of)
    out = {}
    for t in THERAPISTS:
        tid = t["id"]
        att = ATT[(ATT.therapist_id == tid) & (ATT.date > as_of - pd.Timedelta(days=30)) &
                  (ATT.date <= as_of - pd.Timedelta(days=2))]
        lag = (att.note_signed_at - att.start).dt.total_seconds() / 3600
        notes_ok = int(((lag <= 49) & att.note_signed_at.notna() & (att.note_signed_at <= as_of + pd.Timedelta(hours=20))).sum())
        c = C[(C.therapist_id == tid) & (C.submitted > as_of - pd.Timedelta(days=28)) & (C.submitted <= as_of)]
        den = c[c.first_pass == "Denied"].denial_reason.value_counts()
        s_ = S[(S.therapist_id == tid) & (S.rescheduled_from_provider == False)]
        s7 = s_[(s_.date > as_of - pd.Timedelta(days=7)) & (s_.date <= as_of)]
        s28 = s_[(s_.date > as_of - pd.Timedelta(days=28)) & (s_.date <= as_of)]
        is_pc = lambda d: (d.cancelled_by == "Provider") & d.status.isin(["Late cancel", "No-show"])
        out[tid] = dict(notes_ok=notes_ok, notes_n=int(len(att)),
                        claims_ok=int((c.first_pass == "Accepted").sum()), claims_n=int(len(c)),
                        top_denial=None if not len(den) else den.index[0],
                        offered=offered_hours(tid, as_of + pd.Timedelta(days=7)), contracted=t["contracted_hours"],
                        pc7=int(is_pc(s7).sum()), pc28=int(is_pc(s28).sum()), sched28=int(len(s28)),
                        days_since_hire=int((as_of - pd.Timestamp(t["hire_date"])).days))
    return out


def provider_alerts(as_of):
    as_of = pd.Timestamp(as_of)
    out, suppressed = [], []
    for t in THERAPISTS:
        tid = t["id"]
        hire = pd.Timestamp(t["hire_date"])
        if (as_of - hire).days < RAMP_DAYS:
            suppressed.append(dict(therapist_id=tid, reason=f"New hire ({(as_of - hire).days} days); performance alerts start at day {RAMP_DAYS}"))
            continue

        def add(category, title, detail, value=None):
            out.append(dict(therapist_id=tid, tier="High", category=category, title=title, detail=detail,
                            action="Connect with the provider this week to get back on track", owner="Lead",
                            value=value))
        att = ATT[(ATT.therapist_id == tid) & (ATT.date > as_of - pd.Timedelta(days=30)) &
                  (ATT.date <= as_of - pd.Timedelta(days=2))]
        if len(att) >= PA["min_sessions"]:
            lag = (att.note_signed_at - att.start).dt.total_seconds() / 3600
            ok = ((lag <= 49) & att.note_signed_at.notna() & (att.note_signed_at <= as_of + pd.Timedelta(hours=20))).sum()
            r = ok / len(att)
            if r < PA["notes_48h_min"]:
                late = len(att) - ok
                add("Rev cycle", "Notes signed late",
                    f"{r:.0%} of notes signed within 48h over the last 4 weeks ({late} of {len(att)} late). Late notes hold up claims.", r)
        c = C[(C.therapist_id == tid) & (C.submitted > as_of - pd.Timedelta(days=28)) & (C.submitted <= as_of)]
        if len(c) >= PA["min_sessions"]:
            r = (c.first_pass == "Accepted").mean()
            if r < PA["claims_first_pass_min"]:
                top = c[c.first_pass == "Denied"].denial_reason.value_counts()
                add("Rev cycle", "Claim denials",
                    f"{r:.0%} of claims accepted first pass over the last 4 weeks ({(c.first_pass == 'Denied').sum()} denied). "
                    f"Most common reason: {top.index[0]}.", r)
        offered = offered_hours(tid, as_of + pd.Timedelta(days=7))
        if offered < t["contracted_hours"]:
            add("Access", "Fewer hours offered than contracted",
                f"{offered:g} hours open for booking next week vs. {t['contracted_hours']:g} contracted.", offered)
        s = S[(S.therapist_id == tid) & (S.rescheduled_from_provider == False)]
        s7 = s[(s.date > as_of - pd.Timedelta(days=7)) & (s.date <= as_of)]
        s28 = s[(s.date > as_of - pd.Timedelta(days=28)) & (s.date <= as_of)]
        is_pc = lambda d: (d.cancelled_by == "Provider") & d.status.isin(["Late cancel", "No-show"])
        n7, n28 = int(is_pc(s7).sum()), int(is_pc(s28).sum())
        r28 = n28 / len(s28) if len(s28) else 0
        if n7 >= PA["provider_cancels_last_week"] or r28 > PA["provider_cancel_rate_4wk_max"]:
            add("Access", "Provider late cancels / no-shows",
                f"{n7} in the last week; {n28} of {len(s28)} scheduled sessions ({r28:.0%}) over the last 4 weeks.", r28)
    return out, suppressed


def remission_milestones(as_of, days=30):
    """Patients (baseline PHQ-9 >= 10) whose PHQ-9 first dropped below 5 in the window."""
    as_of = pd.Timestamp(as_of)
    out = []
    phq = PHQ[PHQ.date <= as_of].sort_values("date")
    for pid, g in phq.groupby("patient_id"):
        if g.iloc[0].score < 10:
            continue
        below = g[g.score < 5]
        if len(below) and as_of - pd.Timedelta(days=days) < below.iloc[0].date <= as_of:
            out.append(dict(patient_id=pid, therapist_id=g.iloc[0].therapist_id,
                            date=below.iloc[0].date.date().isoformat(), baseline=int(g.iloc[0].score),
                            latest=int(below.iloc[0].score)))
    return out


def scorecard_changes(monthly):
    """monthly: {tid: [(date, statuses, overall), ...]} oldest -> newest month-end closes."""
    alerts, shout = [], []
    for t in THERAPISTS:
        tid = t["id"]
        ser = monthly[tid]
        if len(ser) < 3:
            continue
        (d3, s3, o3), (d2, s2, o2), (d1, s1, o1) = ser[-3:]
        new_ramp = (pd.Timestamp(d1) - pd.Timestamp(t["hire_date"])).days < RAMP_DAYS + 60
        for mid, st in s1.items():
            m = METRIC_BY_ID[mid]
            if st == "context":
                continue
            if st == "below" and s2.get(mid) not in ("below",) and not new_ramp:
                alerts.append(dict(therapist_id=tid, tier="Review", category="Scorecard",
                                   title=f"{m['label']} fell below flag line",
                                   detail=f"{m['label']} moved from {s2.get(mid)} to below at the {pd.Timestamp(d1):%b %d} close.",
                                   action="Performance conversation", owner="Lead", metric=mid))
            if st == "meets" and s2.get(mid) == "meets" and s3.get(mid) in ("watch", "below"):
                shout.append(dict(therapist_id=tid, tier="Recognition", category="Goal met",
                                  title=f"Hit goal: {m['label']}",
                                  detail=f"Met target at the {pd.Timestamp(d2):%b %d} and {pd.Timestamp(d1):%b %d} closes (was {s3.get(mid)} in {pd.Timestamp(d3):%B}).",
                                  action="Give a shoutout", owner="Lead", metric=mid))
        if o1 == "Excelling" and o2 == "Excelling" and o3 != "Excelling":
            shout.append(dict(therapist_id=tid, tier="Recognition", category="Goal met",
                              title="Overall rating: Excelling",
                              detail=f"Rated Excelling at the last two month-end closes (was {o3} in {pd.Timestamp(d3):%B}).",
                              action="Give a shoutout", owner="Lead", metric="overall"))
    return alerts, shout


def build_notifications(daily_date, monday_date, monthly):
    daily_flags = build_case_flags(daily_date)
    monday_flags = build_case_flags(monday_date)
    monday_keys = {(f["patient_id"], f["flag"]) for f in monday_flags}
    daily_items = [dict(f, new_since_monday=(f["patient_id"], f["flag"]) not in monday_keys)
                   for f in daily_flags if f["priority"] == "Urgent"]
    prov, suppressed = provider_alerts(monday_date)
    sc_alerts, sc_shout = scorecard_changes(monthly)
    milestones = remission_milestones(monday_date)
    by_t = {}
    for m in milestones:
        by_t.setdefault(m["therapist_id"], []).append(m)
    patient_shout = [dict(therapist_id=tid, tier="Recognition", category="Patient milestones",
                          title=f"{len(ms)} patient{'s' if len(ms) > 1 else ''} reached remission",
                          detail="PHQ-9 now below 5 after starting at 10 or higher, in the last 30 days.",
                          action="Give a shoutout", owner="Lead", patients=[m["patient_id"] for m in ms])
                     for tid, ms in sorted(by_t.items(), key=lambda kv: -len(kv[1]))]
    review_order = {"High": 0, "Review": 1, "Routine": 2}
    digest = dict(
        date=pd.Timestamp(monday_date).date().isoformat(),
        month_close=monthly[THERAPISTS[0]["id"]][-1][0],
        open_urgent=[f for f in monday_flags if f["priority"] == "Urgent"],
        provider_followups=prov,
        patient_review=sorted([f for f in monday_flags if f["priority"] != "Urgent"],
                              key=lambda f: (f["therapist_id"], review_order[f["priority"]], -f["days_open"])),
        scorecard_changes=sc_alerts,
        shoutouts=sc_shout + patient_shout,
        suppressed=suppressed,
    )
    return dict(rules=NOTIFICATION_RULES, global_rules=GLOBAL_RULES,
                daily=dict(date=pd.Timestamp(daily_date).date().isoformat(), items=daily_items),
                monday_digest=digest, provider_signals=provider_signals(monday_date)), daily_flags


# ---------------------------------------------------------------------------
# 7. Run & export
# ---------------------------------------------------------------------------
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    as_of = pd.Timestamp(AS_OF)
    print(f"computing as of {AS_OF} from {RAW_DIR}")

    therapists_out = []
    for t in THERAPISTS:
        m = compute_metrics(as_of, t["id"])
        statuses = {mid: metric_status(mid, m[mid]) for mid in METRIC_BY_ID}
        therapists_out.append(dict(
            id=t["id"], name=t["name"], credential=t["credential"], hire_date=t["hire_date"],
            tenure_months=int((AS_OF - date.fromisoformat(t["hire_date"])).days / 30.4),
            contracted_hours=t["contracted_hours"],
            metrics=m, statuses=statuses, overall=therapist_status(statuses)))

    pod = compute_metrics(as_of)
    pod_status = {mid: metric_status(mid, pod[mid]) for mid in METRIC_BY_ID}

    # monthly trend (pod + each therapist), last 12 month-ends
    months = list(pd.date_range(end=as_of, periods=11, freq="ME")) + [as_of]  # 11 month-end closes + today
    trend_ids = ["intake_assessment", "followup_assessment", "improvement", "remission", "early_dropout",
                 "provider_cancel", "provider_resched", "notes_48h", "claims_first_pass", "utilization",
                 "safety_response", "pcp_referral", "care_plan", "geriatric_screen"]
    trends = {"months": [d.date().isoformat() for d in months], "pod": {}, "therapists": {}}
    pod_series = [compute_metrics(d) for d in months]
    for mid in trend_ids:
        trends["pod"][mid] = [s[mid]["value"] for s in pod_series]
    monthly = {}
    for t in THERAPISTS:
        ser = [compute_metrics(d, t["id"]) for d in months]
        closes = []
        for d, m_ in zip(months, ser):
            if d.is_month_end and d < as_of:
                st = {mid: metric_status(mid, m_[mid]) for mid in METRIC_BY_ID}
                closes.append((d.date().isoformat(), st, therapist_status(st)))
        monthly[t["id"]] = closes
        trends["therapists"][t["id"]] = {mid: [s[mid]["value"] if (s[mid]["den"] or 0) >= METRIC_BY_ID.get(mid, {}).get("min_n", 0) else None for s in ser] for mid in trend_ids}

    monday = as_of - pd.Timedelta(days=as_of.weekday())
    notifications, flags = build_notifications(as_of, monday, monthly)

    def clean(df):
        df = df.copy()
        for c in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[c]):
                if c in ("start", "note_signed_at"):
                    df[c] = df[c].dt.strftime("%Y-%m-%dT%H:%M")
                else:
                    df[c] = df[c].dt.strftime("%Y-%m-%d")
        df = df.astype(object).where(pd.notna(df), None)
        return df

    data = dict(
        meta=dict(as_of=AS_OF.isoformat(), pod=RULES["pod"]["name"], program=RULES["pod"]["program"],
                  source=_meta.get("source", "export"), generated_note=_meta.get("note", ""),
                  computed_at=datetime.now().isoformat(timespec="seconds")),
        metric_definitions=METRICS,
        therapists=therapists_out,
        pod=dict(metrics=pod, statuses=pod_status),
        trends=trends,
        case_flags=flags,
        notifications=notifications,
    )
    pd.DataFrame(flags).to_csv(os.path.join(OUT_DIR, "case_flags.csv"), index=False)

    write_app_json(data, flags)
    return data


INST_CODE = {"PHQ-9": "PHQ", "GAD-7": "GAD", "Risk screen (C-SSRS)": "RISK", "GDS-15": "GDS", "Mini-Cog": "MC"}
STATUS_CODE = {"Attended": "A", "No-show": "NS", "Late cancel": "LC", "Rescheduled": "RS"}


def write_app_json(data, flags):
    """Compact export for the web app: summary tables plus a per-patient timeline."""
    s = S.copy()
    s["lag_h"] = ((s.note_signed_at - s.start).dt.total_seconds() / 3600).round()
    s_rows = {}
    for pid, g in s.sort_values("start").groupby("patient_id"):
        s_rows[pid] = [[r.date.strftime("%Y-%m-%d"), STATUS_CODE[r.status],
                        (r.cancelled_by if isinstance(r.cancelled_by, str) else ""), r.cpt, int(r.minutes),
                        None if pd.isna(r.lag_h) else int(r.lag_h)] for r in g.itertuples()]
    a_rows = {}
    for pid, g in A.sort_values("date").groupby("patient_id"):
        a_rows[pid] = [[r.date.strftime("%Y-%m-%d"), INST_CODE[r.instrument], int(r.score)] for r in g.itertuples()]
    e_rows = {}
    for pid, g in E.sort_values("date").groupby("patient_id"):
        e_rows[pid] = [[r.type, r.date.strftime("%Y-%m-%d"), r.detail,
                        None if pd.isna(r.resolved_date) else r.resolved_date.strftime("%Y-%m-%d")]
                       for r in g.itertuples()]
    pts = []
    for r in P.itertuples():
        pts.append(dict(id=r.patient_id, name=r.name, t=r.therapist_id, age=int(r.age), sex=r.sex,
                        concern=r.primary_concern, alone=bool(r.lives_alone), caregiver=bool(r.caregiver_involved),
                        modality=r.modality, intake=r.intake_date.strftime("%Y-%m-%d"), status=r.status,
                        discharge=None if pd.isna(r.discharge_date) else r.discharge_date.strftime("%Y-%m-%d"),
                        discharge_reason=r.discharge_reason,
                        s=s_rows.get(r.patient_id, []), a=a_rows.get(r.patient_id, []), e=e_rows.get(r.patient_id, [])))
    c90 = C[(C.submitted > pd.Timestamp(AS_OF) - pd.Timedelta(days=90)) & (C.first_pass == "Denied")]
    denials = [dict(t=r.therapist_id, p=r.patient_id, date=r.submitted.strftime("%Y-%m-%d"), cpt=r.cpt,
                    reason=r.denial_reason) for r in c90.itertuples()]
    summary = dict(meta=data["meta"], metric_definitions=data["metric_definitions"], therapists=data["therapists"],
               pod=data["pod"], trends=data["trends"], case_flags=flags, notifications=data["notifications"], denials=denials,
               codes=dict(instruments={v: k for k, v in INST_CODE.items()}, session_status={v: k for k, v in STATUS_CODE.items()},
                          session_cols=["date", "status", "cancelled_by", "cpt", "minutes", "note_lag_hours"],
                          assessment_cols=["date", "instrument", "score"],
                          event_cols=["type", "date", "detail", "resolved_date"]))

    def default(o):
        if isinstance(o, float) and math.isnan(o):
            return None
        if hasattr(o, "item"):
            return o.item()
        return str(o)
    # Keep the previous computed_at when nothing else changed, so an unchanged day
    # produces no diff (and no redeploy).
    prev_path = os.path.join(OUT_DIR, "summary.json")
    if os.path.exists(prev_path):
        try:
            prev = json.load(open(prev_path))
            new_cmp = json.loads(json.dumps(summary, default=default).replace("NaN", "null"))
            pm, nm = dict(prev.get("meta", {})), dict(new_cmp["meta"])
            pm.pop("computed_at", None); nm.pop("computed_at", None)
            prev["meta"], new_cmp["meta"] = pm, nm
            if prev == new_cmp:
                summary["meta"]["computed_at"] = json.load(open(prev_path))["meta"].get("computed_at")
        except Exception:
            pass
    for name, obj in [("summary.json", summary), ("patients.json", {p["id"]: p for p in pts})]:
        txt = json.dumps(obj, default=default, separators=(",", ":")).replace("NaN", "null")
        with open(os.path.join(OUT_DIR, name), "w") as f:
            f.write(txt)


if __name__ == "__main__":
    data = main()
    n = data["notifications"]
    print(f"done: {len(data['therapists'])} therapists, {len(data['case_flags'])} open patient items, "
          f"{len(n['daily']['items'])} urgent today -> {OUT_DIR}")

