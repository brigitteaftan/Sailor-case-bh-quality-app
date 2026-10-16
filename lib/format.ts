// Date and number formatting shared by server and client.
// Dates are ISO day strings (YYYY-MM-DD); parsing at local noon keeps the day
// stable across time zones (server in UTC, viewer in New York).

export const DAY_MS = 86400000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const parseD = (s: string) => new Date(s + "T12:00:00");
export const fmtDate = (s: string) => { const d = parseD(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export const fmtDateY = (s: string) => { const d = parseD(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const longDate = (s: string) => { const d = parseD(s); return `${WEEKDAYS[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const monthName = (s: string) => MONTHS_LONG[parseD(s).getMonth()];
export const daysBetween = (a: string, b: string) => Math.round((parseD(b).getTime() - parseD(a).getTime()) / DAY_MS);

export const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");

export const tenureText = (months: number) =>
  months >= 12 ? `${Math.floor(months / 12)} yr${months >= 24 ? "s" : ""}` : `${months} mo`;

export const PHQ_SEVERITY: [number, number, string][] = [
  [0, 4, "Minimal"], [5, 9, "Mild"], [10, 14, "Moderate"], [15, 19, "Moderately severe"], [20, 27, "Severe"],
];
export const phqSeverity = (v: number) => PHQ_SEVERITY.find((s) => v >= s[0] && v <= s[1])?.[2] ?? "";
