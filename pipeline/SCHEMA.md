# Daily export contract

The compute engine reads these files from `data/raw/` every weekday morning.
To run the console on real data, deliver files in this shape (from the EHR,
scheduling and billing systems) and run `python3 pipeline/compute.py`. No
code changes are needed as long as the columns match.

All dates are ISO (`YYYY-MM-DD`); timestamps are `YYYY-MM-DDTHH:MM`, local time.
Each file is a full extract (not a delta) covering at least the last 15 months.

## `export_meta.json`

| field | meaning |
|---|---|
| `as_of` | The date the extract represents. The engine computes "as of" this day. |
| `source` | `mock` for the demo data; anything else (e.g. `ehr`) for real data. Controls the "Mock data" banner. |
| `note` | Free text shown in the footer. |

## `therapists.csv` (one row per therapist in the pod)

| column | meaning |
|---|---|
| `therapist_id` | Stable ID |
| `name`, `credential` | Display name; LCSW, LPC, PsyD … |
| `hire_date` | Start date. Drives the 90-day new-hire ramp. |
| `contracted_hours` | Contracted clinical hours per week |

## `schedule.csv` (one row per therapist per week, including next week)

| column | meaning |
|---|---|
| `therapist_id` | |
| `week_start` | Monday of the week |
| `offered_hours` | Bookable clinical hours the therapist opened that week |

## `patients.csv` (one row per episode of care)

| column | meaning |
|---|---|
| `patient_id` | Stable ID |
| `name` | Display name (first name + last initial in the demo) |
| `therapist_id` | Assigned therapist |
| `age`, `sex` | |
| `primary_concern` | Depression, Anxiety, Grief / bereavement, Adjustment to chronic illness, Loneliness / isolation |
| `lives_alone`, `caregiver_involved` | `True` / `False` |
| `modality` | Video or Phone |
| `intake_date` | Date of the intake referral / episode start |
| `status` | `Active` or `Discharged` |
| `discharge_date`, `discharge_reason` | `Planned discharge` or `Lost to follow-up` |

## `sessions.csv` (one row per scheduled appointment)

| column | meaning |
|---|---|
| `session_id`, `patient_id`, `therapist_id` | |
| `date`, `start` | Appointment date and start time |
| `status` | `Attended`, `No-show`, `Late cancel` (< 24h), `Rescheduled` |
| `cancelled_by` | `Provider` or `Patient` (blank when attended) |
| `cpt` | 90791 (intake), 90834 (45 min), 90837 (60 min) |
| `minutes` | Session length (0 if not attended) |
| `session_number` | Attended-session count for the episode |
| `note_signed_at` | When the progress note was signed (blank if unsigned) |
| `rescheduled_from_provider` | `True` when this visit replaced a provider-rescheduled slot (excluded from access denominators) |

## `assessments.csv` (one row per instrument administered)

| column | meaning |
|---|---|
| `patient_id`, `therapist_id`, `date` | |
| `instrument` | `PHQ-9`, `GAD-7`, `Risk screen (C-SSRS)`, `GDS-15`, `Mini-Cog` |
| `score` | Instrument score (risk screen: 1 = positive, 0 = negative) |
| `result` | `Positive` / `Negative` for risk screen and Mini-Cog |

## `care_events.csv` (documentation events the rules look for)

| column | meaning |
|---|---|
| `patient_id`, `therapist_id`, `date` | |
| `type` | `Care plan`, `Care plan review`, `Positive risk screen`, `Physical health concern`, `Elder abuse / neglect concern` |
| `detail` | Free text (e.g. "Recent fall") |
| `resolved_date` | When the required follow-through was documented: safety plan, PCP referral, or safety assessment / APS report. Blank if still open. |
| `resolution` | What was done |

## `claims.csv` (one row per claim)

| column | meaning |
|---|---|
| `claim_id`, `session_id`, `patient_id`, `therapist_id` | |
| `submitted` | Submission date |
| `cpt` | |
| `first_pass` | `Accepted` or `Denied` |
| `denial_reason` | Payer reason when denied |

## Not in the contract, on purpose

Hospital and ED admissions/discharges. Sailor has no reliable signal for them
today. Add an `adt_events.csv` once an ADT notification feed is in place, and
a 7-day follow-up rule can be switched on.
