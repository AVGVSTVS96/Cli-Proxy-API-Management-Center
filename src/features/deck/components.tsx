import type { ReactNode } from 'react';
import { useNow } from '@/hooks/useNow';
import { elapsedAt, fmt, when } from './format';
import type { LimitWindow } from './types';

/** A row of toggle buttons for one choice; the chosen one is pressed. */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The one limit meter: used fill, the policy cutoff tick, and a caret for how much of the window has passed. */
export function Meter({ label, window }: { label: string; window: LimitWindow }) {
  const { used, cutoff, resetsAt } = window;
  const elapsed = elapsedAt(window, useNow());
  const tone = used === null ? '' : used >= cutoff ? 'over' : used >= cutoff - 15 ? 'near' : '';
  const text = used === null ? 'no reading' : `${Math.round(used)}% used, cutoff ${cutoff}%`;

  return (
    <div
      className="meter"
      role="meter"
      aria-valuenow={used ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={text}
    >
      <div className="meter-label">
        <span>{label}</span>
        <b>{used === null ? '–' : `${Math.round(used)}%`}</b>
      </div>
      <div className="meter-track">
        {used !== null && (
          <div className={`meter-fill ${tone}`} style={{ width: `${Math.min(used, 100)}%` }} />
        )}
        <div className="meter-cut" style={{ left: `${cutoff}%` }} />
        {elapsed !== null && <div className="meter-time" style={{ left: `${elapsed * 100}%` }} />}
      </div>
      <div className="meter-foot">
        {resetsAt ? `Resets ${when(resetsAt)}` : 'No reset time'}
        {elapsed !== null && ` · ${fmt.pct(elapsed)} gone`}
      </div>
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="alert" role="alert">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
