import { useEffect, useRef, useState } from 'react';

export interface Bar {
  key: string;
  label: string;
  value: number;
  tip: string;
}

/** Minimal bar chart: one color, quiet grid, tap a bar to read it. */
export function BarChart({ bars, height = 220, format, highlightLast = true }: { bars: Bar[]; height?: number; format: (v: number) => string; highlightLast?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setSel(null), [bars.length]);

  const padL = 56;
  const padB = 28;
  const padT = 28;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const nice = niceMax(max);
  const innerW = w - padL - 4;
  const innerH = height - padB - padT;
  const slot = innerW / Math.max(1, bars.length);
  const bw = Math.min(36, slot * 0.62);
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(innerW / 56)));
  const active = sel ?? (highlightLast ? bars.length - 1 : null);
  const shown = active !== null ? bars[active] : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" width={w} height={height} role="img" aria-label="กราฟยอดขาย">
        {[0, 0.5, 1].map((f) => {
          const y = padT + innerH - innerH * f;
          return (
            <g key={f}>
              <line className="grid" x1={padL} x2={w} y1={y} y2={y} />
              <text className="axis num" x={padL - 8} y={y + 4} textAnchor="end">
                {short(nice * f)}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = (b.value / nice) * innerH;
          const x = padL + slot * i + (slot - bw) / 2;
          return (
            <g key={b.key} onClick={() => setSel(i === sel ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect className={`bar ${i === active ? 'hi' : ''}`} x={x} y={padT + innerH - Math.max(h, b.value > 0 ? 2 : 0)} width={bw} height={Math.max(h, b.value > 0 ? 2 : 0)} rx={Math.min(6, bw / 3)} />
              {i % every === 0 && (
                <text className="axis" x={x + bw / 2} y={height - 8} textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {shown && (
        <div className="t-sm" style={{ position: 'absolute', top: 0, right: 0, textAlign: 'right' }} aria-live="polite">
          <span className="muted">{shown.tip} </span>
          <b className="num">{format(shown.value)}</b>
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

/** Axis labels in baht (values are satang). */
function short(satang: number): string {
  const b = satang / 100;
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(b % 1_000_000 ? 1 : 0)}M`;
  if (b >= 1000) return `${(b / 1000).toFixed(b % 1000 ? 1 : 0)}k`;
  return String(Math.round(b));
}
