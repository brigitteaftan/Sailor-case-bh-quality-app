import Dashboard from "@/components/Dashboard";
import { getSummary, namesFor } from "@/lib/data";

export default function Page() {
  const summary = getSummary();
  const ids = new Set<string>();
  summary.case_flags.forEach((f: any) => ids.add(f.patient_id));
  summary.notifications.daily.items.forEach((f: any) => ids.add(f.patient_id));
  summary.notifications.monday_digest.open_urgent.forEach((f: any) => ids.add(f.patient_id));
  summary.notifications.monday_digest.patient_review.forEach((f: any) => ids.add(f.patient_id));
  summary.notifications.monday_digest.shoutouts.forEach((s: any) => (s.patients || []).forEach((p: string) => ids.add(p)));
  // Send the client only what the dashboard draws (not the per-patient timelines).
  const { denials, ...rest } = summary;
  return <Dashboard summary={rest} names={namesFor(Array.from(ids))} />;
}
