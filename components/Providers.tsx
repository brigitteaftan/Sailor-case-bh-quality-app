"use client";

// App-wide client state: editable thresholds (Rules page) and the hover tooltip.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultThresholds, type Thresholds } from "@/lib/rating";
import { store } from "@/lib/storage";

type ThCtx = {
  th: Thresholds;
  setMetric: (id: string, key: "target" | "flag", v: number) => void;
  setProvider: (key: keyof Thresholds["provider"], v: number) => void;
  reset: () => void;
  changed: boolean;
  defaults: Thresholds;
};
const ThresholdsContext = createContext<ThCtx | null>(null);

type TipState = { content: ReactNode; x: number; y: number } | null;
const TipContext = createContext<{ show: (c: ReactNode, x: number, y: number) => void; hide: () => void } | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const defaults = useMemo(() => defaultThresholds(), []);
  const [th, setTh] = useState<Thresholds>(defaults);

  useEffect(() => {
    const saved = store.get<Thresholds | null>("thresholds", null);
    if (saved && saved.metrics && saved.provider) {
      const merged = defaultThresholds();
      Object.keys(merged.metrics).forEach((k) => { if (saved.metrics[k]) merged.metrics[k] = saved.metrics[k]; });
      Object.assign(merged.provider, saved.provider);
      setTh(merged);
    }
  }, []);

  const save = (next: Thresholds) => { setTh(next); store.set("thresholds", next); };
  const value: ThCtx = {
    th, defaults,
    setMetric: (id, key, v) => save({ ...th, metrics: { ...th.metrics, [id]: { ...th.metrics[id], [key]: v } } }),
    setProvider: (key, v) => save({ ...th, provider: { ...th.provider, [key]: v } }),
    reset: () => save(defaultThresholds()),
    changed: JSON.stringify(th) !== JSON.stringify(defaults),
  };

  const [tip, setTip] = useState<TipState>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const show = useCallback((content: ReactNode, x: number, y: number) => setTip({ content, x, y }), []);
  const hide = useCallback(() => setTip(null), []);
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const r = tipRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = tip.x + 12, top = tip.y - r.height - 10;
    if (left + r.width > vw - 8) left = tip.x - r.width - 12;
    if (left < 8) left = 8;
    if (top < 8) top = tip.y + 14;
    if (top + r.height > vh - 8) top = vh - r.height - 8;
    setPos({ left, top });
  }, [tip]);

  return (
    <ThresholdsContext.Provider value={value}>
      <TipContext.Provider value={useMemo(() => ({ show, hide }), [show, hide])}>
        {children}
        {tip && (
          <div className="tip" ref={tipRef} style={{ left: pos.left, top: pos.top }} role="tooltip">
            {tip.content}
          </div>
        )}
      </TipContext.Provider>
    </ThresholdsContext.Provider>
  );
}

export const useThresholds = () => useContext(ThresholdsContext)!;
export const useTip = () => useContext(TipContext)!;

/** Small transient confirmation message. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 1800);
  }, []);
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return { toast, node };
}
