import type { Account, LimitWindow } from './types';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const compact1 = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const cents = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmt = {
  tokens: (n: number) => (n < 1000 ? String(Math.round(n)) : compact.format(n)),
  axis: (n: number) => compact1.format(n),
  usd: (n: number) => (n >= 1000 ? dollars.format(n) : cents.format(n)),
  pts: (n: number | null) => (n === null ? '–' : n === 0 ? '0' : n < 0.05 ? '<0.1' : n.toFixed(1)),
  /** Percentage points of an account's limit, the unit every limit share is in. */
  limit: (n: number | null) =>
    n === null ? '–' : n === 0 ? '0%' : n < 0.05 ? '<0.1%' : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`,
  pct: (n: number) => `${Math.round(n * 100)}%`,
  int: (n: number) => n.toLocaleString('en'),
};

const timeOfDay = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/** "4:10 PM" within a day, "Thu 9:00 AM" within a week, else "Oct 24". */
export const when = (at: number) => {
  const away = Math.abs(at - Date.now());

  return away < 20 * 3_600_000
    ? timeOfDay.format(at)
    : away < 6 * 86_400_000
      ? weekday.format(at)
      : day.format(at);
};

export const dayOf = (at: number) => day.format(at);

const UNITS: [limit: number, size: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [Infinity, 86_400, 'day'],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const relativeTime = (when: number) => {
  const seconds = (Date.now() - when) / 1000;
  const [, size, unit] = UNITS.find(([limit]) => Math.abs(seconds) < limit) ?? UNITS[3];

  return relative.format(-Math.round(seconds / size), unit);
};

export const STANDING = {
  next: 'Takes the next session',
  open: 'Open',
  tight: 'Near a cutoff',
  limited: 'At a cutoff',
  'signed-out': 'Signed out',
} as const satisfies Record<Account['standing'], string>;

/** `elapsed` is the share gone when the reading was taken; carry it forward to `now`. */
export function elapsedAt({ elapsed, sampledAt, resetsAt }: LimitWindow, now: number) {
  if (elapsed === null || sampledAt === null || resetsAt === null) return elapsed;
  const length = (resetsAt - sampledAt) / Math.max(1 - elapsed, 0.001);

  return Math.min(1, elapsed + (now - sampledAt) / length);
}

/** Round axis steps (1, 2, 2.5, 5 × 10^n) covering 0..max with about `count` ticks. */
export function ticks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;

  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => i * step);
}

/** Accounts keep one hue wherever they're drawn, picked by id so a change in rank never repaints them. */
const ACCOUNT_SLOTS = [0, 4, 5, 3, 6, 2, 1];

export const accountHue = (id: string, ids: readonly string[]) => {
  const i = [...ids].sort().indexOf(id);

  return i < 0 ? 'muted' : String(ACCOUNT_SLOTS[i % ACCOUNT_SLOTS.length]);
};

/** An account's short name: the part before @, or the company for a work address ("shahidy"). */
export const shortAccount = (label: string) => {
  const [local, domain = ''] = label.split('@');

  return /^(gmail|googlemail|icloud|me|outlook|hotmail|proton|protonmail)\./.test(domain) || !domain
    ? local
    : domain.split('.')[0];
};
