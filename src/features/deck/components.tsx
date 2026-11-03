import type { ReactNode } from 'react';
import { useNow } from '@/hooks/useNow';
import { elapsedAt, fmt, when } from './format';
import type { LimitWindow } from './types';

const SDK_ENTRYPOINTS = new Set(['sdk-cli', 'sdk-ts', 'sdk-py']);

export const isAgentSdk = (entrypoint: string) => SDK_ENTRYPOINTS.has(entrypoint);

/**
 * Marks work that runs on the Agent SDK or `claude -p`. Where an account has a five-hour limit,
 * that meter charges it more per token than interactive Claude Code; weekly use is the same.
 * A share under 1 marks a group that only partly runs on it.
 */
export function SdkMark({ share }: { share: number }) {
  if (share < 0.05) return null;
  const part = share < 0.95 ? ` ${Math.round(share * 100)}%` : '';

  return (
    <span
      className="sdk-mark"
      title={`${Math.round(share * 100)}% of this ran on the Agent SDK or claude -p, which a five-hour limit charges more per token than interactive Claude Code`}
    >
      SDK{part}
    </span>
  );
}

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

/**
 * The one limit meter: used fill in the account's hue (amber near the cutoff, red past it), the
 * cutoff tick, and a faint mark for how much of the window has passed, so pace reads at a glance.
 * A window Anthropic sends no reading for collapses to one quiet line.
 */
export function Meter({
  label,
  window,
  hue,
  size = 'md',
}: {
  label: string;
  window: LimitWindow;
  hue?: string;
  size?: 'md' | 'sm';
}) {
  const { used, cutoff, resetsAt } = window;
  const elapsed = elapsedAt(window, useNow());

  if (used === null)
    return (
      <div className={`meter ${size} unread`}>
        <div className="meter-label">
          <span>{label}</span>
          <span className="muted">not reported</span>
        </div>
      </div>
    );

  const tone = used >= cutoff ? 'over' : used >= cutoff - 15 ? 'near' : '';
  const ahead = elapsed !== null && used / 100 - elapsed;

  return (
    <div
      className={`meter ${size}`}
      role="meter"
      aria-valuenow={used}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={`${Math.round(used)}% used, cutoff ${cutoff}%`}
      data-c={hue}
    >
      <div className="meter-label">
        <span>{label}</span>
        <b className={tone}>{Math.round(used)}%</b>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${tone}`} style={{ width: `${Math.min(used, 100)}%` }} />
        {elapsed !== null && <div className="meter-time" style={{ left: `${elapsed * 100}%` }} />}
        <div className="meter-cut" style={{ left: `${cutoff}%` }} />
      </div>
      <div className="meter-foot">
        {resetsAt ? `Resets ${when(resetsAt)}` : 'No reset time'}
        {elapsed !== null && ` · ${fmt.pct(elapsed)} of it gone`}
        {ahead !== false && ahead > 0.2 && used < cutoff && <span className="warn"> · ahead of pace</span>}
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
