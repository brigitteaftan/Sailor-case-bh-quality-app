// Server-side data access.
//
// Today this reads the files the daily pipeline writes to data/computed/.
// If the team later moves to a database, these functions are the only place
// that changes: keep the same return shapes and the pages keep working.

import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "computed");
let _summary: any = null;
let _patients: Record<string, any> | null = null;

export function getSummary(): any {
  if (!_summary) _summary = JSON.parse(fs.readFileSync(path.join(DIR, "summary.json"), "utf8"));
  return _summary;
}

function allPatients(): Record<string, any> {
  if (!_patients) _patients = JSON.parse(fs.readFileSync(path.join(DIR, "patients.json"), "utf8"));
  return _patients!;
}

export function getPatient(id: string) {
  return allPatients()[id] ?? null;
}

export function getTherapist(id: string) {
  return getSummary().therapists.find((t: any) => t.id === id) ?? null;
}

export type PatientRow = {
  id: string; name: string; age: number; concern: string; intake: string;
  sessions: number; lastVisit: string | null; phqIntake: number | null; phqLatest: number | null; openItems: number;
};

export function patientStats(p: any) {
  const att = p.s.filter((s: any[]) => s[1] === "A");
  const phq = p.a.filter((a: any[]) => a[1] === "PHQ");
  return {
    sessions: att.length,
    lastVisit: att.length ? att[att.length - 1][0] : null,
    phqIntake: phq.length ? phq[0][2] : null,
    phqLatest: phq.length ? phq[phq.length - 1][2] : null,
  };
}

/** Active patients on a therapist's caseload, most in need of attention first. */
export function getActivePatients(tid: string): PatientRow[] {
  const flags = getSummary().case_flags;
  return Object.values(allPatients())
    .filter((p: any) => p.t === tid && p.status === "Active")
    .map((p: any) => ({
      id: p.id, name: p.name, age: p.age, concern: p.concern, intake: p.intake, ...patientStats(p),
      openItems: flags.filter((f: any) => f.patient_id === p.id).length,
    }))
    .sort((a, b) => b.openItems - a.openItems || (b.phqLatest ?? -1) - (a.phqLatest ?? -1));
}

/** Names for the patients referenced by open items (keeps client payloads small). */
export function namesFor(ids: string[]): Record<string, string> {
  const all = allPatients(), out: Record<string, string> = {};
  ids.forEach((id) => { if (all[id]) out[id] = all[id].name; });
  return out;
}

export function searchPatients(q: string, limit = 20) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return Object.values(allPatients())
    .filter((p: any) => p.id.toLowerCase().includes(s) || p.name.toLowerCase().includes(s))
    .slice(0, limit)
    .map((p: any) => ({ id: p.id, name: p.name, t: p.t, status: p.status, age: p.age }));
}
