// Small presentational pieces shared across pages.

import type { MetricStatus, Overall } from "@/lib/rating";
import { statusLabel } from "@/lib/rating";

const OCLASS: Record<Overall, string> = {
  "Needs attention": "o-needs", Watch: "o-watch", "On track": "o-ontrack", Excelling: "o-excel", "Too early to rate": "o-early",
};
const SCLS: Record<MetricStatus, string> = { meets: "c-meets", watch: "c-watch", below: "c-below", insufficient: "c-insufficient", context: "c-context" };
const SICON: Record<MetricStatus, string> = { meets: "✓", watch: "!", below: "✕", insufficient: "–", context: "" };

export const Pill = ({ o }: { o: Overall }) => <span className={`pill ${OCLASS[o]}`}>{o}</span>;

export const StatusChip = ({ s }: { s: MetricStatus }) => (
  <span className={`chip ${SCLS[s]}`}>
    <span className="i" aria-hidden="true">{SICON[s]}</span>
    {statusLabel(s)}
  </span>
);

export const PRIORITY_CLASS: Record<string, string> = { Urgent: "c-urgent", High: "c-high", Review: "c-review", Routine: "c-routine" };
export const PriorityChip = ({ p }: { p: string }) => <span className={`chip ${PRIORITY_CLASS[p] || "c-routine"}`}>{p}</span>;

export const URGENT_CAT: Record<string, { label: string; icon: "risk" | "shield" | "pcp"; rank: number }> = {
  "Positive risk screen, no safety plan": { label: "Suicide risk", icon: "risk", rank: 0 },
  "Elder abuse / neglect concern, no report on file": { label: "Elder safety", icon: "shield", rank: 1 },
  "Health concern not sent to PCP": { label: "PCP escalation", icon: "pcp", rank: 2 },
};

export function Icon({ name }: { name: "risk" | "shield" | "pcp" }) {
  if (name === "risk")
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.8 14.6 13.5H1.4Z" /><path d="M8 6.2v3.4" /><path d="M8 11.7v.1" />
      </svg>
    );
  if (name === "shield")
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.5 13.5 3.5v4c0 3.4-2.4 5.9-5.5 7-3.1-1.1-5.5-3.6-5.5-7v-4Z" /><path d="M8 5.5v3" /><path d="M8 10.8v.1" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export const shortName = (name: string) => {
  const parts = name.split(" ");
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
};
