"""
Mock daily exports for the Pod Quality Console.  SYNTHETIC DATA ONLY.

Stands in for the files an EHR and billing system would drop each morning
(see pipeline/SCHEMA.md). Simulates one therapy pod of 11 therapists and
~1,900 older-adult Medicare patients over ~18 months. Each therapist has a
scripted behaviour "archetype" so the pod tells a realistic story; the
archetypes never leave this file -- the compute engine only sees the raw
exports, exactly as it would with real data.

Run:  python3 pipeline/mock/generate_mock_exports.py   (deterministic seed)
Then: python3 pipeline/compute.py
"""

import json
import math
import os
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

SEED = 20261014
rng = np.random.default_rng(SEED)

AS_OF = date(2026, 10, 14)          # the "today" of the mock export
HIST_START = date(2025, 4, 1)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW_DIR = os.path.join(ROOT, "data", "raw")

# ---------------------------------------------------------------------------
# 2. Therapist archetypes
# ---------------------------------------------------------------------------
BASE = dict(
    capacity=26, contracted=26, intakes_per_month=9.0, target_util=0.86,
    k=0.055, k_sigma=0.45, nonresp=0.20, worsen=0.04,
    early_drop=0.10, later_drop_hazard=0.010,
    p_intake_assess=0.99, p_careplan=0.99, p_geri=0.985,
    p_measure=0.92, measure_wks=4,
    p_safety=1.0, p_pcp=0.97,
    prov_cancel=0.012, prov_resched=0.028,
    note_med_h=14, note_sigma=0.7, claim_ok=0.972,
    p_90837=0.65, p_fu7=0.88,
)

THERAPISTS = [
    dict(id="T01", name="Maya Lindqvist", credential="LCSW", hire_date="2020-02-10",
         archetype="Star: strong outcomes, excellent process, reliable",
         over=dict(k=0.076, nonresp=0.12, early_drop=0.06, target_util=0.9, p_intake_assess=0.99, p_careplan=0.99,
                   p_geri=0.99, p_measure=0.97, p_safety=1.0, p_pcp=0.95, prov_cancel=0.008,
                   prov_resched=0.02, note_med_h=6, claim_ok=0.985, p_fu7=0.97)),
    dict(id="T02", name="Daniel Osei", credential="PsyD", hire_date="2021-09-13",
         archetype="Steady performer",
         over=dict(k=0.058)),
    dict(id="T03", name="Rosa Delgado-Hart", credential="LMFT", hire_date="2022-05-02",
         archetype="Steady performer, slightly below on outcomes",
         over=dict(k=0.047, nonresp=0.24)),
    dict(id="T04", name="Priya Natarajan", credential="LCSW", hire_date="2021-01-19",
         archetype="Strong; care-coordination champion (PCP referrals, hospital follow-up)",
         over=dict(k=0.068, nonresp=0.15, p_pcp=1.0, p_fu7=1.0, note_med_h=10)),
    dict(id="T05", name="Kevin Marsh", credential="LPC", hire_date="2023-03-06",
         archetype="High volume, weak outcomes: big caseload, short sessions, high early dropout",
         over=dict(capacity=33, contracted=30, intakes_per_month=14, target_util=0.97, k=0.028, nonresp=0.34, p_intake_assess=0.95, p_careplan=0.93,
                   early_drop=0.30, later_drop_hazard=0.018, p_90837=0.20, p_measure=0.80)),
    dict(id="T06", name="Hannah Abernathy", credential="LCSW", hire_date="2022-10-17",
         archetype="Good clinician, documentation slipping since summer: late notes, claim denials",
         over=dict(k=0.064),
         drift=dict(note_med_h=("2026-06-15", 68), claim_ok=("2026-06-15", 0.86))),
    dict(id="T07", name="Owen Fairbanks", credential="LMHC", hire_date="2023-08-21",
         archetype="Rarely re-administers PHQ-9, so outcomes can't be confirmed",
         over=dict(k=0.055, p_measure=0.09, p_intake_assess=0.90)),
    dict(id="T08", name="Celeste Moreau", credential="LCSW", hire_date="2022-02-28",
         archetype="Solid clinically; access problem since July (provider cancels and reschedules)",
         over=dict(k=0.066, nonresp=0.16, target_util=0.78),
         drift=dict(prov_cancel=("2026-07-01", 0.085), prov_resched=("2026-07-01", 0.13),
                    capacity=("2026-09-14", 20))),
    dict(id="T09", name="Marcus Bell", credential="LPC", hire_date="2024-01-08",
         archetype="Safety process gap: misses same-day safety plans and geriatric screens",
         over=dict(k=0.052, p_safety=0.55, p_geri=0.70, p_careplan=0.93, p_pcp=0.62)),
    dict(id="T10", name="Jun Takahashi", credential="LCSW", hire_date="2026-08-10",
         archetype="New hire (2 months): too early to judge outcomes",
         over=dict(capacity=16, contracted=26, intakes_per_month=9.0, target_util=0.62, k=0.055, p_careplan=0.9,
                   note_med_h=20)),
    dict(id="T11", name="Grace Oyelaran", credential="PhD", hire_date="2019-06-03",
         archetype="Part-time, excellent outcomes",
         over=dict(capacity=16, contracted=16, intakes_per_month=6, target_util=0.88, k=0.084, nonresp=0.09,
                   early_drop=0.07, p_measure=0.96, note_med_h=8)),
]


def tparams(t, d):
    """Behaviour parameters for therapist t on date d (applies drift)."""
    p = dict(BASE)
    p.update(t.get("over", {}))
    for key, (start, val) in t.get("drift", {}).items():
        if d >= date.fromisoformat(start):
            p[key] = val
    return p


# ---------------------------------------------------------------------------
# 3. Patient population (older adults on Medicare)
# ---------------------------------------------------------------------------
FIRST_F = ["Eleanor", "Dorothy", "Ruth", "Betty", "Joan", "Shirley", "Marilyn", "Carol", "Judith",
           "Barbara", "Gloria", "Lorraine", "Phyllis", "Irene", "Gladys", "Bernice", "Doris", "Loretta",
           "Rosa", "Yvonne", "Mae", "Constance", "Harriet", "Mildred", "Lucille", "Ada", "Esther",
           "Marjorie", "Agnes", "Pauline", "Beatriz", "Mei", "Ines", "Ida", "Frances", "Vera"]
FIRST_M = ["Harold", "Walter", "Raymond", "Eugene", "Frank", "Gerald", "Howard", "Leonard",
           "Stanley", "Arthur", "Clarence", "Bernard", "Ernest", "Lloyd", "Melvin", "Roy",
           "Theodore", "Albert", "Herbert", "Wendell", "Luis", "Hiroshi", "Samuel", "Otis",
           "Calvin", "Norman", "Felix", "Rudy", "Vernon", "Milton"]
LAST_INITIALS = list("ABCDEFGHJKLMNOPRSTVWY")

CONCERNS = [  # (label, weight, baseline PHQ mean)
    ("Depression", 0.38, 14.5),
    ("Anxiety", 0.18, 11.0),
    ("Grief / bereavement", 0.16, 13.5),
    ("Adjustment to chronic illness", 0.16, 12.0),
    ("Loneliness / isolation", 0.12, 12.5),
]

HEALTH_CONCERNS = ["Recent fall", "New or worsening pain", "Possible medication side effects",
                   "Weight loss / poor appetite", "Sleep problems", "Memory changes noticed",
                   "Uncontrolled blood sugar reported", "Shortness of breath reported"]
DENIAL_REASONS = ["Telehealth modifier missing (95/93)", "Session time not documented for 90837",
                  "Diagnosis code not specific enough", "Medicare ID (MBI) mismatch",
                  "Plan of care not on file"]


def weighted_choice(items, weights):
    weights = np.array(weights, dtype=float)
    return items[rng.choice(len(items), p=weights / weights.sum())]


def poisson_dates(start, end, per_month):
    out, d = [], start
    rate_per_day = per_month / 30.4
    while True:
        d = d + timedelta(days=float(rng.exponential(1 / rate_per_day)))
        if d >= end:
            return out
        out.append(d)


def to_date(x):
    return x.date() if isinstance(x, datetime) else x


def next_weekday(d):
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def phq_latent(baseline, k, weeks):
    return baseline * math.exp(-k * weeks)


def clip_int(x, lo, hi):
    return int(max(lo, min(hi, round(x))))


# ---------------------------------------------------------------------------
# 4. Simulation
# ---------------------------------------------------------------------------
patients, sessions, assessments, care_events, claims = [], [], [], [], []
pid_counter = [1000]
sid_counter = [0]


def new_sid():
    sid_counter[0] += 1
    return f"S{sid_counter[0]:06d}"


def simulate_patient(t, intake_day):
    pid_counter[0] += 1
    pid = f"P-{pid_counter[0]}"
    p0 = tparams(t, intake_day)

    sex = "F" if rng.random() < 0.62 else "M"
    first = rng.choice(FIRST_F if sex == "F" else FIRST_M)
    name = f"{first} {rng.choice(LAST_INITIALS)}."
    age = int(min(96, 65 + rng.gamma(2.2, 4.2)))
    concern = weighted_choice([c[0] for c in CONCERNS], [c[1] for c in CONCERNS])
    phq_mean = dict((c[0], c[2]) for c in CONCERNS)[concern]
    baseline = clip_int(rng.normal(phq_mean, 5.0), 3, 26)
    gad_base = clip_int(baseline * 0.7 + rng.normal(0, 3) + (3 if concern == "Anxiety" else 0), 0, 21)
    gds = clip_int(baseline * 0.5 + rng.normal(0, 2), 0, 15)
    minicog = int(rng.choice([5, 4, 4, 3, 3, 2, 1], p=[0.32, 0.22, 0.14, 0.12, 0.06, 0.09, 0.05]))
    lives_alone = bool(rng.random() < (0.62 if concern == "Loneliness / isolation" else 0.42))
    caregiver = bool(rng.random() < (0.55 if minicog < 3 else 0.22))
    modality = "Video" if rng.random() < 0.68 else "Phone"

    # outcome trajectory
    r = rng.random()
    if r < p0["worsen"]:
        k = -abs(rng.normal(0.012, 0.005))
        ptype = "worsening"
    elif r < p0["worsen"] + p0["nonresp"]:
        k = abs(rng.normal(0.004, 0.003))
        ptype = "nonresponder"
    else:
        k = p0["k"] * float(rng.lognormal(0, p0["k_sigma"]))
        ptype = "responder"
    max_weeks = int(rng.integers(18, 44))
    early_drop = rng.random() < p0["early_drop"]
    early_drop_after = int(rng.choice([1, 2], p=[0.55, 0.45]))
    weekly_throughout = rng.random() < 0.35
    hospital_week = None
    if rng.random() < 0.08:
        hospital_week = float(rng.uniform(2, min(max_weeks, 30)))
    hosp_type = weighted_choice(["Psychiatric ED visit", "Psychiatric hospitalization", "Medical hospitalization"],
                                [0.33, 0.17, 0.50])

    pat = dict(patient_id=pid, name=name, therapist_id=t["id"], age=age, sex=sex,
               primary_concern=concern, lives_alone=lives_alone, caregiver_involved=caregiver,
               modality=modality, intake_date=intake_day.isoformat(),
               status=None, discharge_date=None, discharge_reason=None)

    # ---- walk the schedule ----
    d = next_weekday(intake_day)
    session_n = 0  # attended count
    last_phq_day = None
    last_score = None
    health_concerns_n = 0
    hosp_done = False
    pending_post_hosp = None   # (discharge_day, type)
    ended = None

    def add_assessment(day, inst, score, **extra):
        a = dict(patient_id=pid, therapist_id=t["id"], date=day.isoformat(), instrument=inst, score=score)
        a.update(extra)
        assessments.append(a)

    def attended_session(day, cpt, minutes, rescheduled=False):
        nonlocal session_n
        session_n += 1
        p = tparams(t, day)
        hour = int(rng.integers(9, 17))
        start = datetime(day.year, day.month, day.day, hour, 0)
        lag_h = float(rng.lognormal(math.log(p["note_med_h"]), p["note_sigma"]))
        signed = start + timedelta(minutes=minutes) + timedelta(hours=lag_h)
        signed_iso = signed.isoformat(timespec="minutes") if signed.date() <= AS_OF and signed <= datetime(AS_OF.year, AS_OF.month, AS_OF.day, 20) else None
        sid = new_sid()
        sessions.append(dict(session_id=sid, patient_id=pid, therapist_id=t["id"], date=day.isoformat(),
                             start=start.isoformat(timespec="minutes"), status="Attended", cancelled_by=None,
                             cpt=cpt, minutes=minutes, session_number=session_n,
                             note_signed_at=signed_iso, rescheduled_from_provider=rescheduled))
        if signed_iso:
            sub = signed + timedelta(days=1)
            if sub.date() <= AS_OF:
                ok = rng.random() < p["claim_ok"]
                claims.append(dict(claim_id="C" + sid[1:], session_id=sid, patient_id=pid, therapist_id=t["id"],
                                   submitted=sub.date().isoformat(), cpt=cpt,
                                   first_pass="Accepted" if ok else "Denied",
                                   denial_reason=None if ok else str(rng.choice(DENIAL_REASONS))))
        return start

    def do_phq(day, weeks, is_intake=False):
        nonlocal last_phq_day, last_score
        latent = phq_latent(baseline, k, weeks)
        score = baseline if is_intake else clip_int(latent + rng.normal(0, 1.8), 0, 27)
        add_assessment(day, "PHQ-9", score)
        last_phq_day, last_score = day, score
        # suicide-risk screen alongside every PHQ-9
        p_pos = 0.01 + max(0.0, score - 9) * 0.012
        positive = bool(rng.random() < p_pos)
        add_assessment(day, "Risk screen (C-SSRS)", 1 if positive else 0, result="Positive" if positive else "Negative")
        if positive:
            p = tparams(t, day)
            r2 = rng.random()
            if r2 < p["p_safety"]:
                sp_day = day
            elif r2 < p["p_safety"] + (1 - p["p_safety"]) * 0.6:
                sp_day = day + timedelta(days=int(rng.integers(2, 10)))
            else:
                sp_day = None
            care_events.append(dict(patient_id=pid, therapist_id=t["id"], type="Positive risk screen",
                                    date=day.isoformat(), detail=f"PHQ-9 {score}; C-SSRS positive",
                                    resolved_date=sp_day.isoformat() if sp_day and sp_day <= AS_OF else None,
                                    resolution="Safety plan completed" if sp_day and sp_day <= AS_OF else None))
        return score

    care_plan_target = None
    p_in = tparams(t, intake_day)
    cp_r = rng.random()
    if cp_r < p_in["p_careplan"]:
        care_plan_target = 2
    elif cp_r < p_in["p_careplan"] + (1 - p_in["p_careplan"]) * 0.6:
        care_plan_target = int(rng.integers(3, 6))
    geri_r = rng.random()
    if geri_r < p_in["p_geri"]:
        geri_target = int(rng.choice([1, 2], p=[0.7, 0.3]))
    elif geri_r < p_in["p_geri"] + (1 - p_in["p_geri"]) * 0.5:
        geri_target = int(rng.integers(3, 7))
    else:
        geri_target = None
    ia_r = rng.random()
    if ia_r < p_in["p_intake_assess"]:
        intake_assess_at = 1
    elif ia_r < p_in["p_intake_assess"] + (1 - p_in["p_intake_assess"]) * 0.7:
        intake_assess_at = int(rng.choice([2, 3]))
    else:
        intake_assess_at = None
    intake_assessed = False

    while d <= AS_OF:
        weeks = (d - intake_day).days / 7.0
        p = tparams(t, d)

        # hospitalization interrupts care
        if hospital_week is not None and not hosp_done and weeks >= hospital_week:
            hosp_done = True
            los = {"Psychiatric ED visit": int(rng.integers(0, 2)),
                   "Psychiatric hospitalization": int(rng.integers(5, 13)),
                   "Medical hospitalization": int(rng.integers(3, 9))}[hosp_type]
            adm = d - timedelta(days=int(rng.integers(1, 4)))
            dis = adm + timedelta(days=los)
            if adm <= AS_OF:
                care_events.append(dict(patient_id=pid, therapist_id=t["id"], type=hosp_type,
                                        date=adm.isoformat(), detail=f"Discharged {dis.isoformat()}" if dis <= AS_OF else "Currently admitted",
                                        resolved_date=None, resolution=None, discharge_date=dis.isoformat() if dis <= AS_OF else None))
            if dis > AS_OF:
                break
            if rng.random() < p["p_fu7"]:
                d = next_weekday(dis + timedelta(days=int(rng.integers(1, 6))))
                pending_post_hosp = (dis, "fu")
            else:
                d = next_weekday(dis + timedelta(days=int(rng.integers(9, 17))))
                pending_post_hosp = (dis, "late")
            if d > AS_OF:
                break
            continue

        # session outcome
        r = rng.random()
        first_session = session_n == 0
        pc, pr = p["prov_cancel"], p["prov_resched"]
        pt_ns = 0.065 + (0.02 if modality == "Phone" else 0)
        pt_lc = 0.05
        start = datetime(d.year, d.month, d.day, int(rng.integers(9, 17)), 0)
        if not first_session and r < pc:
            sessions.append(dict(session_id=new_sid(), patient_id=pid, therapist_id=t["id"], date=d.isoformat(),
                                 start=start.isoformat(timespec="minutes"),
                                 status=str(rng.choice(["Late cancel", "No-show"], p=[0.75, 0.25])),
                                 cancelled_by="Provider", cpt=None, minutes=0, session_number=None,
                                 note_signed_at=None, rescheduled_from_provider=False))
        elif not first_session and r < pc + pr:
            sessions.append(dict(session_id=new_sid(), patient_id=pid, therapist_id=t["id"], date=d.isoformat(),
                                 start=start.isoformat(timespec="minutes"), status="Rescheduled",
                                 cancelled_by="Provider", cpt=None, minutes=0, session_number=None,
                                 note_signed_at=None, rescheduled_from_provider=False))
            nd = next_weekday(d + timedelta(days=int(rng.integers(2, 6))))
            if nd <= AS_OF:
                minutes = 60 if rng.random() < p["p_90837"] else 45
                attended_session(nd, "90837" if minutes == 60 else "90834", minutes, rescheduled=True)
        elif not first_session and r < pc + pr + pt_ns + pt_lc:
            sessions.append(dict(session_id=new_sid(), patient_id=pid, therapist_id=t["id"], date=d.isoformat(),
                                 start=start.isoformat(timespec="minutes"),
                                 status="No-show" if r < pc + pr + pt_ns else "Late cancel",
                                 cancelled_by="Patient", cpt=None, minutes=0, session_number=None,
                                 note_signed_at=None, rescheduled_from_provider=False))
        else:
            if first_session:
                attended_session(d, "90791", 60)
            else:
                minutes = 60 if rng.random() < p["p_90837"] else 45
                attended_session(d, "90837" if minutes == 60 else "90834", minutes)
            n = session_n
            # intake measures
            if not intake_assessed and intake_assess_at is not None and n >= intake_assess_at:
                do_phq(d, weeks, is_intake=True)
                add_assessment(d, "GAD-7", gad_base)
                intake_assessed = True
            elif intake_assessed and last_phq_day is not None:
                due = (d - last_phq_day).days >= p["measure_wks"] * 7 - 3
                if due and rng.random() < p["p_measure"]:
                    do_phq(d, weeks)
            elif not intake_assessed and intake_assess_at is None and n >= 4 and rng.random() < p["p_measure"] * 0.5:
                # never did an intake measure; occasional later PHQ (no true baseline)
                do_phq(d, weeks)
                intake_assessed = True
            if geri_target is not None and n == geri_target:
                add_assessment(d, "GDS-15", gds)
                add_assessment(d, "Mini-Cog", minicog, result="Positive" if minicog < 3 else "Negative")
            if care_plan_target is not None and n == care_plan_target:
                care_events.append(dict(patient_id=pid, therapist_id=t["id"], type="Care plan",
                                        date=d.isoformat(), detail="Initial care plan documented",
                                        resolved_date=None, resolution=None))
            if care_plan_target is not None and n > 2 and (n - care_plan_target) % 7 == 0 and n != care_plan_target:
                care_events.append(dict(patient_id=pid, therapist_id=t["id"], type="Care plan review",
                                        date=d.isoformat(), detail="90-day care plan review",
                                        resolved_date=None, resolution=None))
            # physical health concern surfaced in therapy
            if n > 1 and health_concerns_n < 2 and rng.random() < 0.013:
                health_concerns_n += 1
                pr_r = rng.random()
                if pr_r < p["p_pcp"]:
                    ref = d + timedelta(days=int(rng.integers(0, 6)))
                elif pr_r < p["p_pcp"] + (1 - p["p_pcp"]) * 0.45:
                    ref = d + timedelta(days=int(rng.integers(9, 26)))
                else:
                    ref = None
                care_events.append(dict(patient_id=pid, therapist_id=t["id"], type="Physical health concern",
                                        date=d.isoformat(), detail=str(rng.choice(HEALTH_CONCERNS)),
                                        resolved_date=ref.isoformat() if ref and ref <= AS_OF else None,
                                        resolution="Referred to PCP" if ref and ref <= AS_OF else None))
            pending_post_hosp = None

            # end-of-episode logic
            if early_drop and n >= early_drop_after:
                ended = ("dropout", d)
                break
            if n > 3 and rng.random() < p["later_drop_hazard"]:
                ended = ("dropout", d)
                break
            latent = phq_latent(baseline, k, weeks)
            if weeks >= 12 and latent < 5 and rng.random() < 0.35:
                ended = ("planned", d)
                break
            if weeks >= max_weeks:
                ended = ("planned", d)
                break

        # next appointment
        gap = 7 if (weeks < 8 or weekly_throughout) else 14
        d = next_weekday(d + timedelta(days=gap + int(rng.integers(-1, 2))))

    # status
    att = [s for s in sessions if s["patient_id"] == pid and s["status"] == "Attended"]
    last_att = date.fromisoformat(att[-1]["date"]) if att else intake_day
    if ended and ended[0] == "planned":
        if last_phq_day is not None and rng.random() < tparams(t, ended[1])["p_measure"] and last_phq_day != ended[1]:
            do_phq(ended[1], (ended[1] - intake_day).days / 7.0)
        pat.update(status="Discharged", discharge_date=ended[1].isoformat(), discharge_reason="Planned discharge")
    elif ended and ended[0] == "dropout":
        if (AS_OF - last_att).days > 60:
            closed = last_att + timedelta(days=int(rng.integers(55, 75)))
            pat.update(status="Discharged", discharge_date=min(closed, AS_OF).isoformat(),
                       discharge_reason="Lost to follow-up")
        else:
            pat.update(status="Active")
    else:
        pat.update(status="Active")
    pat["_type"] = ptype  # internal, dropped from app export
    patients.append(pat)
    # date this patient stops occupying a caseload slot
    if pat["discharge_date"]:
        return date.fromisoformat(pat["discharge_date"])
    if ended and ended[0] == "dropout":
        return last_att + timedelta(days=30)
    return AS_OF + timedelta(days=365)


HOURS_PER_PATIENT_WEEK = 0.50  # observed avg attended hours per active patient per week

for t in THERAPISTS:
    hire = date.fromisoformat(t["hire_date"])
    start = max(HIST_START, hire)
    p = tparams(t, start)
    target_caseload = p["capacity"] * p["target_util"] / HOURS_PER_PATIENT_WEEK
    ends = []
    sid_start = len(sessions)
    # seed an existing panel at the start of history (so the caseload isn't empty)
    if hire < HIST_START:
        for _ in range(int(target_caseload * 0.95)):
            back = int(rng.integers(5, 200))
            ends.append(simulate_patient(t, HIST_START - timedelta(days=back)))
    # candidate referrals arrive faster than capacity; accept only when the
    # therapist's already-booked hours over the next 4 weeks leave room (else waitlist)
    my_sessions_from = sid_start
    for d0 in poisson_dates(start, AS_OF - timedelta(days=1), p["intakes_per_month"]):
        d0 = d0.date() if isinstance(d0, datetime) else d0
        lo, hi = d0.isoformat(), (d0 + timedelta(days=28)).isoformat()
        booked = sum(s["minutes"] for s in sessions[my_sessions_from:]
                     if s["status"] == "Attended" and lo <= s["date"] < hi) / 60 / 4
        if booked < tparams(t, d0)["capacity"] * tparams(t, d0)["target_util"] * 0.88:
            ends.append(simulate_patient(t, d0))

# ---------------------------------------------------------------------------
# 4b. Scripted showcase cases (so the review queue has a realistic spread of
#     urgent items on "day one"). Layered on top of simulated patients.
# ---------------------------------------------------------------------------
def _att(pid):
    return sorted([s for s in sessions if s["patient_id"] == pid and s["status"] == "Attended"],
                  key=lambda s: s["date"])


def _pick(tid, cond, used):
    cands = [p for p in patients if p["therapist_id"] == tid and p["status"] == "Active"
             and p["patient_id"] not in used]
    order = rng.permutation(len(cands))
    for i in order:
        p = cands[i]
        att = _att(p["patient_id"])
        if att and cond(p, att):
            return p, att
    raise RuntimeError(f"no candidate for showcase case on {tid}")


def _days_ago(iso):
    return (AS_OF - date.fromisoformat(iso)).days


def inject_showcase_cases():
    used = set()

    def phq_scores(pid):
        return sorted([a for a in assessments if a["patient_id"] == pid and a["instrument"] == "PHQ-9"],
                      key=lambda a: a["date"])

    # (a) T09: positive risk screen 1 week ago, no safety plan on file
    def cond_recent_no_phq(lo, hi):
        def c(p, att):
            last = att[-1]["date"]
            ph = phq_scores(p["patient_id"])
            return lo <= _days_ago(last) <= hi and ph and ph[-1]["date"] != last and len(att) >= 5
        return c
    for (tid, lo, hi, late) in [("T09", 3, 9, None), ("T09", 15, 30, 4), ("T05", 2, 8, None)]:
        p, att = _pick(tid, cond_recent_no_phq(lo, hi), used)
        used.add(p["patient_id"])
        day = att[-1]["date"]
        prev = phq_scores(p["patient_id"])[-1]["score"]
        score = min(25, max(prev + 6, 16))
        assessments.append(dict(patient_id=p["patient_id"], therapist_id=tid, date=day, instrument="PHQ-9", score=score))
        assessments.append(dict(patient_id=p["patient_id"], therapist_id=tid, date=day,
                                instrument="Risk screen (C-SSRS)", score=1, result="Positive"))
        res = (date.fromisoformat(day) + timedelta(days=late)).isoformat() if late else None
        care_events.append(dict(patient_id=p["patient_id"], therapist_id=tid, type="Positive risk screen",
                                date=day, detail=f"PHQ-9 {score}; C-SSRS positive",
                                resolved_date=res, resolution="Safety plan completed" if res else None))

    # (b) elder abuse / neglect disclosures: history (handled) + one open, disclosed Oct 13
    all_att = [x for x in sessions if x["status"] == "Attended" and "2025-11-01" <= x["date"] <= "2026-09-30"]
    for i in rng.choice(len(all_att), 6, replace=False):
        x = all_att[int(i)]
        lag = int(rng.choice([0, 0, 0, 1]))
        care_events.append(dict(patient_id=x["patient_id"], therapist_id=x["therapist_id"],
                                type="Elder abuse / neglect concern", date=x["date"],
                                detail=str(rng.choice(["Possible financial exploitation by a relative",
                                                       "Possible neglect by paid caregiver",
                                                       "Self-neglect: not eating, home unsafe"])),
                                resolved_date=(date.fromisoformat(x["date"]) + timedelta(days=lag)).isoformat(),
                                resolution="Safety assessment documented; APS report filed"))
    p, att = _pick("T03", lambda p, att: len(att) >= 6 and _days_ago(att[-1]["date"]) <= 12, used)
    used.add(p["patient_id"])
    day = next_weekday(AS_OF - timedelta(days=1))
    if day > AS_OF - timedelta(days=1):
        day = AS_OF - timedelta(days=1)
    tid = "T03"
    sid = new_sid()
    st = datetime(day.year, day.month, day.day, 11, 0)
    sessions.append(dict(session_id=sid, patient_id=p["patient_id"], therapist_id=tid, date=day.isoformat(),
                         start=st.isoformat(timespec="minutes"), status="Attended", cancelled_by=None, cpt="90837",
                         minutes=60, session_number=len(att) + 1,
                         note_signed_at=(st + timedelta(hours=5)).isoformat(timespec="minutes"),
                         rescheduled_from_provider=False))
    care_events.append(dict(patient_id=p["patient_id"], therapist_id=tid, type="Elder abuse / neglect concern",
                            date=day.isoformat(), detail="Possible financial exploitation by a relative",
                            resolved_date=None, resolution=None))

    # (c) T02: recent fall raised in session, not yet sent to PCP
    p, att = _pick("T02", lambda p, att: 9 <= _days_ago(att[-1]["date"]) <= 16 or
                   any(9 <= _days_ago(s["date"]) <= 16 for s in att), used)
    used.add(p["patient_id"])
    day = next(s["date"] for s in reversed(att) if 9 <= _days_ago(s["date"]) <= 16)
    care_events.append(dict(patient_id=p["patient_id"], therapist_id="T02", type="Physical health concern",
                            date=day, detail="Recent fall", resolved_date=None, resolution=None))


inject_showcase_cases()

# Drop pre-history events (keep the patients, but history starts HIST_START)
sessions[:] = [s for s in sessions if s["date"] >= HIST_START.isoformat()]

# ---------------------------------------------------------------------------
# 5. Write the daily export files (what Sailor's systems would hand over)
# ---------------------------------------------------------------------------
HOSPITAL_TYPES = {"Psychiatric ED visit", "Psychiatric hospitalization", "Medical hospitalization"}


def target_as_of():
    """The 'today' of the export: MOCK_AS_OF (YYYY-MM-DD) if set, else today in New York."""
    v = os.environ.get("MOCK_AS_OF")
    if v:
        return date.fromisoformat(v)
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return date.today()


def write_exports():
    """Write the exports, shifted so the simulation's 'today' lands on the real date.

    The pod is always simulated around a fixed base date (AS_OF), so the patients,
    therapists and their stories never change. Every date is then moved by the same
    number of days, which keeps the demo current without re-rolling the data.
    """
    os.makedirs(RAW_DIR, exist_ok=True)
    today = target_as_of()
    delta = timedelta(days=(today - AS_OF).days)

    def sd(v):   # shift an ISO date string
        return (date.fromisoformat(v) + delta).isoformat() if isinstance(v, str) and v else v

    def sdt(v):  # shift an ISO datetime string (YYYY-MM-DDTHH:MM)
        return (datetime.fromisoformat(v) + delta).isoformat(timespec="minutes") if isinstance(v, str) and v else v

    pd.DataFrame([dict(therapist_id=t["id"], name=t["name"], credential=t["credential"], hire_date=sd(t["hire_date"]),
                       contracted_hours=tparams(t, AS_OF)["contracted"]) for t in THERAPISTS]) \
        .to_csv(os.path.join(RAW_DIR, "therapists.csv"), index=False)

    # weekly bookable hours each therapist opened in the scheduling system (incl. next week)
    rows = []
    start = HIST_START + delta
    wk = start - timedelta(days=start.weekday())
    last = today - timedelta(days=today.weekday()) + timedelta(days=7)
    while wk <= last:
        for t in THERAPISTS:
            if date.fromisoformat(t["hire_date"]) + delta <= wk + timedelta(days=6):
                rows.append(dict(therapist_id=t["id"], week_start=wk.isoformat(), offered_hours=tparams(t, wk - delta)["capacity"]))
        wk += timedelta(days=7)
    pd.DataFrame(rows).to_csv(os.path.join(RAW_DIR, "schedule.csv"), index=False)

    # Realism pass: in practice an urgent item doesn't sit open for weeks -- once it
    # escalates, it gets worked. Items older than 10 days are closed late (still a
    # miss on the therapist's scorecard), leaving a realistic handful open today.
    late_rng = np.random.default_rng(SEED + 1)
    urgent_types = {"Positive risk screen": (3, 9, "Safety plan completed (late)"),
                    "Physical health concern": (8, 14, "Referred to PCP (late)"),
                    "Elder abuse / neglect concern": (2, 5, "Safety assessment documented; APS report filed (late)")}
    for e in care_events:
        if e["type"] in urgent_types and not e.get("resolved_date"):
            d = date.fromisoformat(e["date"])
            if (AS_OF - d).days > 10:
                lo, hi, label = urgent_types[e["type"]]
                e["resolved_date"] = min(AS_OF, d + timedelta(days=int(late_rng.integers(lo, hi + 1)))).isoformat()
                e["resolution"] = label

    pts = pd.DataFrame(patients).drop(columns=["_type"])
    for c in ["intake_date", "discharge_date"]:
        pts[c] = pts[c].map(sd)
    pts.to_csv(os.path.join(RAW_DIR, "patients.csv"), index=False)

    ses = pd.DataFrame(sessions)
    ses["date"] = ses["date"].map(sd)
    for c in ["start", "note_signed_at"]:
        ses[c] = ses[c].map(sdt)
    ses.to_csv(os.path.join(RAW_DIR, "sessions.csv"), index=False)

    asm = pd.DataFrame(assessments)
    asm["date"] = asm["date"].map(sd)
    asm.to_csv(os.path.join(RAW_DIR, "assessments.csv"), index=False)

    # Sailor has no reliable signal for hospital / ED stays (no ADT feed), so those
    # events never appear in an export. The simulation still uses them (care gaps).
    ev = pd.DataFrame([e for e in care_events if e["type"] not in HOSPITAL_TYPES])
    ev = ev.drop(columns=[c for c in ["discharge_date"] if c in ev.columns])
    for c in ["date", "resolved_date"]:
        ev[c] = ev[c].map(sd)
    ev.to_csv(os.path.join(RAW_DIR, "care_events.csv"), index=False)

    clm = pd.DataFrame(claims)
    clm["submitted"] = clm["submitted"].map(sd)
    clm.to_csv(os.path.join(RAW_DIR, "claims.csv"), index=False)

    json.dump(dict(as_of=today.isoformat(), source="mock", note="Synthetic data only. No real patients or providers."),
              open(os.path.join(RAW_DIR, "export_meta.json"), "w"), indent=2)
    print(f"wrote mock exports for {today} to {RAW_DIR}: {len(patients)} patients, {len(sessions)} sessions")


if __name__ == "__main__":
    write_exports()
