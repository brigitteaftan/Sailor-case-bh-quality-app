# Pod Quality Console

A working tool for a clinical quality lead who oversees a pod of mental health
therapists serving older adults on Medicare. It answers three questions every
morning:

1. **What needs me today?** Urgent patient-safety escalations: positive suicide-risk
   screens without a same-day safety plan, elder abuse or neglect disclosures without a
   report, and physical health concerns not yet sent to the PCP.
2. **How is each therapist doing?** A scorecard across process, clinical outcomes,
   access and documentation, with who needs attention and who is excelling.
3. **What do I do this week?** A Monday digest across the whole pod: provider
   follow-ups, a patient review list for supervision, scorecard changes at month-end,
   and shoutouts.

> **All data in this repository is synthetic.** No real patients or providers.
> Built as a case-study prototype for Sailor Health.

## How it works

```
EHR / scheduling / billing exports            config/rules.json
 (data/raw/*.csv, see pipeline/SCHEMA.md)      (metrics, targets, flag lines, alert rules)
                 │                                       │
                 └──────────────┬────────────────────────┘
                                ▼
                    pipeline/compute.py   ← runs every weekday morning
                                │            (.github/workflows/daily.yml)
              ┌─────────────────┼──────────────────────┐
              ▼                 ▼                      ▼
   data/computed/summary.json   patients.json   pipeline/notify.py
   (scorecards, flags,          (chart          (daily urgent list +
    daily + Monday lists)        timelines)      Monday digest → Slack)
              │
              ▼
     Next.js app (app/, components/) → deployed on Vercel
```

- **The compute engine** never sees anything but the raw exports and the rules file, so
  real data can replace the mock files without code changes.
- **The app** reads the computed files through `lib/data.ts`, the one place to swap
  in a database later.
- **Thresholds** default to `config/rules.json`. The Rules page lets a lead try other
  values and see the dashboard re-rate immediately (saved in their browser for the demo).

## Repository layout

| Path | What it is |
|---|---|
| `app/` | Next.js routes: dashboard, `/rules`, `/therapists/[id]`, `/patients/[id]`, `/patients?q=`, and read APIs under `/api` |
| `components/` | UI: dashboard sections, therapist and patient views, rules editor, charts |
| `lib/rating.ts` | Rating and alert rules used by the app (mirrors the pipeline) |
| `lib/data.ts` | Server-side data access |
| `config/rules.json` | Metric definitions, targets, flag lines, notification rules |
| `pipeline/compute.py` | Daily compute engine |
| `pipeline/notify.py` | Sends the daily urgent list and Monday digest |
| `pipeline/SCHEMA.md` | The daily export contract |
| `pipeline/mock/generate_mock_exports.py` | Generates the synthetic pod (11 therapists, ~1,900 patients, 18 months) |
| `data/raw/` | Today's exports (mock) |
| `data/computed/` | Pipeline output the app serves |

## Run it locally

```bash
npm install
npm run dev                      # http://localhost:3000

# Recompute after changing data or rules (Python 3.10+)
pip install -r pipeline/requirements.txt
npm run pipeline                 # python3 pipeline/compute.py
npm run notify                   # writes messages to data/computed/outbox/

# Regenerate the synthetic pod from scratch
npm run pipeline:mock && npm run pipeline
```

## Deploy

1. Import this repository in Vercel (**Add New → Project**). No settings to change.
2. Every push to `main` redeploys. The daily GitHub Action commits fresh results each
   weekday morning, which triggers a redeploy. In demo mode it also regenerates the mock
   exports so the dashboard's "today" is the real date (same patients and stories; only
   the dates move).
3. Optional: add a `SLACK_WEBHOOK_URL` repository secret and an `APP_URL` repository
   variable to post notifications to Slack.

## Taking it to production

The demo is structured for real use. Before real patient data goes in:

- **Hosting and access:** HIPAA-eligible hosting under a BAA, SSO login, role-based
  access (lead vs. therapist), and audit logging of every chart view.
- **Shared state:** move resolutions and audit notes, and threshold changes, from browser
  storage (`lib/storage.ts`) to a database so the whole team sees the same state.
- **Data feed:** replace the "Load today's exports" step in the workflow with the real
  extract (SFTP, S3 or API) that matches `pipeline/SCHEMA.md`.
- **Notifications:** keep Slack and email messages to patient IDs and a link, as
  `notify.py` does now.
- **Next rule to add:** 7-day follow-up after hospital or ED discharge, once an ADT feed
  exists.
