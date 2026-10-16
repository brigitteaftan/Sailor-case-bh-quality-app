"""
Send the clinical quality lead's notifications.

  Daily (weekdays): urgent escalations only.
  Monday:           the full pod digest.

Reads data/computed/summary.json (written by compute.py). Posts to Slack when
SLACK_WEBHOOK_URL is set; always writes the messages to data/computed/outbox/
so they can be reviewed or sent by another channel (e.g. email).

Messages carry patient IDs, not names (minimum necessary); the link opens the
chart inside the app, behind login in production.

  python3 pipeline/notify.py            # daily list; adds the digest on Mondays
  python3 pipeline/notify.py --digest   # force the Monday digest
"""

import argparse
import json
import os
import urllib.request
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SUMMARY = os.path.join(ROOT, "data", "computed", "summary.json")
OUTBOX = os.path.join(ROOT, "data", "computed", "outbox")
APP_URL = os.environ.get("APP_URL", "").rstrip("/")

CAT = {
    "Positive risk screen, no safety plan": "Suicide risk",
    "Elder abuse / neglect concern, no report on file": "Elder safety",
    "Health concern not sent to PCP": "PCP escalation",
}


def link(path, text):
    return f"<{APP_URL}{path}|{text}>" if APP_URL else text


def daily_message(s):
    d = s["notifications"]["daily"]
    tname = {t["id"]: t["name"] for t in s["therapists"]}
    items = sorted(d["items"], key=lambda f: (list(CAT).index(f["flag"]), -f["days_open"]))
    if not items:
        return f"*Urgent escalations, {d['date']}*\nNothing open. "
    esc = sum(1 for f in items if f["escalated"])
    lines = [f"*Urgent escalations, {d['date']}*: {len(items)} open"
             + (f", {esc} escalated to the clinical director" if esc else "")]
    for f in items:
        tags = (" [ESCALATED]" if f["escalated"] else "") + (" [NEW]" if f.get("new_since_monday") else "")
        lines.append(f"• *{CAT[f['flag']]}* · {link('/patients/' + f['patient_id'], f['patient_id'])} · "
                     f"{tname[f['therapist_id']]} · open {f['days_open']}d{tags}\n   Next step: {f['recommended_action']}")
    lines.append(link("/", "Open the dashboard"))
    return "\n".join(lines)


def digest_message(s):
    g = s["notifications"]["monday_digest"]
    tname = {t["id"]: t["name"] for t in s["therapists"]}
    out = [f"*Monday digest, {g['date']}*",
           f"Open urgent items: {len(g['open_urgent'])}",
           f"Patients for review: {len(g['patient_review'])}", ""]
    if g["provider_followups"]:
        out.append("*Provider follow-ups this week*")
        for a in g["provider_followups"]:
            out.append(f"• {tname[a['therapist_id']]}: {a['title']}. {a['detail']}")
        out.append("")
    if g["scorecard_changes"]:
        out.append(f"*Scorecard changes ({g['month_close']} close)*")
        for a in g["scorecard_changes"]:
            out.append(f"• {tname[a['therapist_id']]}: {a['title']}")
        out.append("")
    if g["shoutouts"]:
        out.append("*Shoutouts*")
        for a in g["shoutouts"]:
            out.append(f"• {tname[a['therapist_id']]}: {a['title']}")
    out.append(link("/", "Open the dashboard"))
    return "\n".join(out)


def post_slack(text):
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        return False
    req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=15).read()
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--digest", action="store_true", help="send the Monday digest regardless of the day")
    args = ap.parse_args()
    s = json.load(open(SUMMARY))
    os.makedirs(OUTBOX, exist_ok=True)
    msgs = [("daily.md", daily_message(s))]
    if args.digest or date.today().weekday() == 0:
        msgs.append(("monday_digest.md", digest_message(s)))
    for name, text in msgs:
        with open(os.path.join(OUTBOX, name), "w") as f:
            f.write(text + "\n")
        sent = post_slack(text)
        print(f"{name}: {'posted to Slack' if sent else 'written to outbox (SLACK_WEBHOOK_URL not set)'}")


if __name__ == "__main__":
    main()
