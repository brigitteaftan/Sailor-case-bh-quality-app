// Read API for integrations (e.g. a Slack bot or BI tool). In production this sits behind auth.
import { getSummary } from "@/lib/data";

export function GET() {
  const { meta, pod, therapists, notifications, case_flags } = getSummary();
  return Response.json({ meta, pod, therapists, notifications, case_flags });
}
