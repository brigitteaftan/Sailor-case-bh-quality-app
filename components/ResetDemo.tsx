"use client";

// Demo-only: reopen every resolved item and restore default thresholds in this browser,
// so the next person (e.g. in a live walkthrough) starts from a clean slate.

import { useState } from "react";
import { useResolutions, useThresholds } from "./Providers";

export default function ResetDemo() {
  const { resolved, clearAll } = useResolutions();
  const { reset, changed } = useThresholds();
  const [done, setDone] = useState(false);
  const n = Object.keys(resolved).length;
  return (
    <span>
      <button className="linkish" style={{ fontSize: 12 }} onClick={() => { clearAll(); reset(); setDone(true); setTimeout(() => setDone(false), 2000); }}>
        Reset demo
      </button>
      <span className="muted"> · {done ? "Everything reopened and thresholds restored." : `reopens ${n} resolved item${n === 1 ? "" : "s"}${changed ? " and restores default thresholds" : ""} in this browser`}</span>
    </span>
  );
}
