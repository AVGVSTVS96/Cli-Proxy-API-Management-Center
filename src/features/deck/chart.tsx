import { useState, type ReactNode } from 'react';
import { useWidth } from './useWidth';
import { dayOf, ticks } from './format';
import './chart.scss';

export type Series = { key: string; label: string; color: number; values: number[] };

const PAD = { top: 8, right: 8, bottom: 22, left: 48 };

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = x > width / 2 ? undefined : x + 12;
  const right = x > width / 2 ? width - x + 12 : undefined;

  return (
    <div className="tip" style={{ left, right, top: 0 }}>
      {children}
    </div>
  );
}

/** Stacked columns, one per bucket, with value axis, legend and a per-column readout on hover or focus. */
export function Columns({
  labels,
  titles,
  series,
  format,
  axis = format,
  height = 220,
  caption,
}: {
  /** Axis text per bucket; an empty string leaves that bucket unlabelled. */
  labels: string[];
  titles: string[];
  series: Series[];
  format: (n: number) => string;
  axis?: (n: number) => string;
  height?: number;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const scale = ticks(Math.max(...totals, 0));
  const top = scale[scale.length - 1] || 1;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = labels.length ? plotW / labels.length : 0;
  const bar = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelled = labels.flatMap((l, i) => (l ? [i] : []));
  const gap = labelled.length > 1 ? labelled[1] - labelled[0] : 1;
  const every = gap * Math.max(1, Math.ceil(56 / Math.max(band * gap, 1)));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${caption}. Arrow keys step through the ${labels.length} columns.`}
          tabIndex={0}
          onFocus={() => setActive((a) => a ?? labels.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;

            if (!step) return;
            e.preventDefault();
            setActive((a) => Math.min(labels.length - 1, Math.max(0, (a ?? 0) + step)));
          }}
        >
          {scale.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? 'baseline' : 'gridline'}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="tick" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {axis(t)}
              </text>
            </g>
          ))}
          {labels.map((label, i) => {
            const x = PAD.left + i * band + (band - bar) / 2;
            let base = 0;

            return (
              <g
                key={titles[i]}
                className={i === active ? 'col on' : 'col'}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              >
                <rect
                  className="hit"
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                {series.map((s) => {
                  const v = s.values[i] ?? 0;

                  if (v <= 0) return null;
                  const y0 = y(base);
                  const y1 = y(base + v);

                  base += v;

                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={y1}
                      width={bar}
                      height={Math.max(0, y0 - y1)}
                      style={{ fill: `var(--series-${s.color})` }}
                      stroke="var(--bg-primary)"
                      strokeWidth={series.length > 1 ? 1 : 0}
                    />
                  );
                })}
                {label && (i - (labelled[0] ?? 0)) % every === 0 && (
                  <text
                    className="tick"
                    x={PAD.left + i * band + band / 2}
                    y={height - 6}
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && (
        <Tip x={PAD.left + active * band + band / 2} width={width}>
          <div className="tip-row">
            <span />
            <span>{titles[active]}</span>
            <b>{format(totals[active])}</b>
          </div>
          {series
            .filter((s) => (s.values[active] ?? 0) > 0)
            .reverse()
            .map((s) => (
              <div key={s.key} className="tip-row" data-c={s.color}>
                <i />
                <span className="muted">{s.label}</span>
                <b>{format(s.values[active])}</b>
              </div>
            ))}
        </Tip>
      )}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key} data-c={s.color}>
              <i className="swatch" data-c={s.color} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A row's activity over the range, as small columns in its own color. */
export function Spark({
  values,
  color,
  width = 96,
  height = 20,
}: {
  values: number[];
  color: number;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values, 0) || 1;
  const band = width / Math.max(values.length, 1);

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      data-c={color}
      aria-hidden
    >
      <path
        d={values
          .map((v, i) =>
            v > 0
              ? `M${i * band},${height}v${-Math.max(1, (v / max) * height)}h${Math.max(1, band - 1)}V${height}z`
              : ''
          )
          .join('')}
      />
    </svg>
  );
}

/** `color` is a palette slot ("0" to "7") or "ink" / "muted", for lines that aren't an agent. */
export type Line = {
  key: string;
  label: string;
  color: string;
  /** A quieter companion line, such as an account's five-hour use beside its week. */
  faint?: boolean;
  /** Named at the line's end, with its last value. */
  end?: string;
  points: [at: number, value: number][];
};

const valueAt = (line: Line, t: number) => {
  let value: number | null = null;

  for (const [at, v] of line.points) if (at <= t) value = v;

  return value;
};

/** Pushes end labels apart so none overlap, keeping each as near its line as it can. */
function spread(ys: number[], gap: number, min: number, max: number) {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = [...ys];
  let last = -Infinity;

  for (const [y, i] of order) {
    out[i] = Math.max(y, last + gap, min);
    last = out[i];
  }

  for (let k = order.length - 1, next = Infinity; k >= 0; k--) {
    const i = order[k][1];

    out[i] = Math.min(out[i], next - gap, max);
    next = out[i];
  }

  return out;
}

/** Step lines of limit use (0 to 100%) over time, with the policy cutoffs and a crosshair readout. */
export function Steps({
  lines,
  from,
  to,
  cutoffs,
  height = 220,
  caption,
}: {
  lines: Line[];
  from: number;
  to: number;
  cutoffs: { label: string; value: number }[];
  height?: number;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelled = lines.filter((l) => l.end && l.points.length);
  const pad = { top: 10, right: labelled.length ? 112 : 12, bottom: 22, left: 36 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (t: number) => pad.left + ((t - from) / (to - from || 1)) * plotW;
  const y = (v: number) => pad.top + plotH - (Math.min(v, 100) / 100) * plotH;

  const days: number[] = [];

  for (const d = new Date(from); d.setHours(24, 0, 0, 0) < to; ) days.push(d.getTime());

  const step = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 64))));
  const at = hover === null ? null : from + ((hover - pad.left) / (plotW || 1)) * (to - from);

  const shown = (line: Line) => line.points.filter(([t]) => t >= from && t <= to);
  const path = (line: Line) =>
    shown(line)
      .map(
        ([t, v], i, all) =>
          (i === 0 ? `M${x(t)},${y(v)}` : `H${x(t)}V${y(v)}`) +
          (i === all.length - 1 && !line.faint ? `H${x(to)}` : '')
      )
      .join('');

  const last = (line: Line) => line.points[line.points.length - 1]?.[1] ?? 0;
  const ends = spread(
    labelled.map((l) => y(last(l))),
    15,
    pad.top + 4,
    pad.top + plotH
  );

  return (
    <div className="chart steps" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={caption}
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left;

            setHover(px >= pad.left && px <= pad.left + plotW ? px : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 50, 100].map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? 'baseline' : 'gridline'}
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="tick" x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {cutoffs.map((c, i) => (
            <g key={c.label}>
              <line
                className="cutoff"
                x1={pad.left}
                x2={pad.left + plotW}
                y1={y(c.value)}
                y2={y(c.value)}
              />
              <text
                className="tick cutoff-label"
                x={pad.left + 4}
                y={y(c.value) + (i % 2 ? 12 : -4)}
              >
                {c.label} cutoff {c.value}%
              </text>
            </g>
          ))}
          {days.map((t, i) =>
            i % step === 0 ? (
              <text key={t} className="tick" x={x(t)} y={height - 6} textAnchor="middle">
                {dayOf(t)}
              </text>
            ) : null
          )}
          {lines.map((line) => (
            <path
              key={line.key}
              className={line.faint ? 'step faint' : 'step'}
              d={path(line)}
              data-c={line.color}
            />
          ))}
          {labelled.map((line, i) => (
            <g key={line.key} data-c={line.color} className="end">
              <circle cx={x(to)} cy={y(last(line))} r={4} />
              <text className="end-label" x={x(to) + 10} y={ends[i] + 4}>
                <tspan className="end-value">{Math.round(last(line))}%</tspan> {line.end}
              </text>
            </g>
          ))}
          {hover !== null && (
            <line className="crosshair" x1={hover} x2={hover} y1={pad.top} y2={pad.top + plotH} />
          )}
        </svg>
      )}
      {at !== null && hover !== null && (
        <Tip x={hover} width={width}>
          <div className="tip-row">
            <span />
            <span>
              {new Date(at).toLocaleString('en', {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <span />
          </div>
          {lines.map((line) => {
            const v = valueAt(line, at);

            return v === null ? null : (
              <div key={line.key} className="tip-row" data-c={line.color}>
                <i className={line.faint ? 'faint' : undefined} />
                <span className="muted">{line.label}</span>
                <b>{Math.round(v)}%</b>
              </div>
            );
          })}
        </Tip>
      )}
    </div>
  );
}
