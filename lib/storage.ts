// Browser-only persistence for the demo.
//
// In production, resolved items (with their audit notes) and threshold changes
// belong in a shared database so the whole team sees the same state. This
// module is the single place to swap: replace these calls with API requests
// to that store. Every read and write is wrapped because browser storage can
// be unavailable (private windows, blocked site data).

const PREFIX = "pqc:";

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = window.localStorage.getItem(PREFIX + key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable: state lives for this session only */
    }
  },
};

export type Resolution = { note: string; at: string };
export const resolutionKey = (f: { patient_id: string; flag: string; since: string }) => `${f.patient_id}|${f.flag}|${f.since}`;
