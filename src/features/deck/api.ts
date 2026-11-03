import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores';
import { computeApiUrl } from '@/utils/connection';
import type { Account, LiveSession, LiveState, LiveValue, Pool, ServerEvent } from './types';

/** The proxy's own management API serves Usage, Live and Accounts, with the key the dashboard signed in with. */
function request(path: string, init: RequestInit = {}) {
  const { apiBase, managementKey } = useAuthStore.getState();

  return fetch(`${computeApiUrl(apiBase)}/deck${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${managementKey}` },
  }).then((response) => {
    if (response.status === 401) window.dispatchEvent(new Event('unauthorized'));

    return response;
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init).catch(() => {
    throw new Error("The proxy didn't answer");
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);

  return body;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export const send = <T>(path: string, method: string, body?: Record<string, Json>) =>
  api<T>(
    path,
    body
      ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method }
  );

/** A file's raw bytes, for pictures an <img> can't fetch with the key itself. */
export async function blob(path: string): Promise<Blob> {
  const response = await request(path);

  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed (${response.status})`);

  return response.blob();
}

export const putText = (path: string, text: string) =>
  api<{ ok: true }>(path, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: text });

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Entry = { data: unknown; error: string | null; fetching: boolean; tags: string[] };

const cache = new Map<string, Entry>();
const users = new Map<string, number>();
const stale = new Set<string>();
const latest = new Map<string, number>();
const cacheListeners = new Set<() => void>();
let requests = 0;

const onCache = (listener: () => void) => {
  cacheListeners.add(listener);

  return () => cacheListeners.delete(listener);
};

function update(path: string, patch: Partial<Entry>) {
  const entry = cache.get(path);

  if (!entry) return;
  cache.set(path, { ...entry, ...patch });

  for (const listener of cacheListeners) listener();
}

function load(path: string) {
  const id = ++requests;

  latest.set(path, id);
  stale.delete(path);
  update(path, { fetching: true });

  return api<unknown>(path).then(
    (data) => latest.get(path) === id && update(path, { data, error: null, fetching: false }),
    (error) => {
      if (latest.get(path) !== id) return;
      stale.add(path);
      update(path, { error: messageOf(error), fetching: false });
    }
  );
}

/** A tag ending in ":" matches every tag with that prefix, so "repo:" follows all repos. */
const tagged = (tags: string[], tag: string) =>
  tags.some((t) => t === tag || (t.endsWith(':') && tag.startsWith(t)));

/** Shown paths refetch now; the rest refetch the next time a page shows them. */
function invalidate(match: (tags: string[]) => boolean) {
  for (const [path, entry] of cache) {
    if (!match(entry.tags)) continue;

    if (users.get(path)) void load(path);
    else stale.add(path);
  }
}

/**
 * A cached GET of the deck views, keyed by its path. It stays fresh until the stream names one of its tags
 * in a `stale` event; a null path reads nothing.
 */
export function useDeck<T>(path: string | null, ...tags: string[]) {
  const entry = useSyncExternalStore(onCache, () => (path ? cache.get(path) : undefined));
  const tagKey = tags.join(' ');

  useEffect(() => {
    if (!path) return;

    if (!cache.has(path)) {
      cache.set(path, { data: null, error: null, fetching: false, tags: tagKey.split(' ') });
      stale.add(path);
    }

    users.set(path, (users.get(path) ?? 0) + 1);

    if (stale.has(path)) void load(path);

    return () => void users.set(path, (users.get(path) ?? 1) - 1);
  }, [path, tagKey]);

  return {
    // SAFETY: a path's answer always has the shape its caller names; deck's contract fixes it.
    data: (entry?.data ?? null) as T | null,
    error: entry?.error ?? null,
    fetching: entry?.fetching ?? false,
    reload: useCallback(async () => void (path && (await load(path))), [path]),
  };
}

type LiveOf<K extends string> = K extends `s:${string}`
  ? LiveSession
  : K extends `a:${string}`
    ? Account
    : K extends 'pool'
      ? Pool
      : { connected: boolean };

let live: Record<string, LiveValue> = {};
let connected = false;
const liveListeners = new Set<() => void>();
const lists = new Map<string, { from: Record<string, LiveValue>; list: [string, LiveValue][] }>();

const subscribe = (listener: () => void) => {
  if (!stream && !document.hidden) void connect();
  liveListeners.add(listener);

  return () => liveListeners.delete(listener);
};

const publish = () => {
  for (const listener of liveListeners) listener();
};

function apply(event: ServerEvent) {
  if (event.type === 'stale') {
    for (const tag of event.tags) invalidate((tags) => tagged(tags, tag));

    return;
  }

  if (event.type === 'snapshot') live = event.live;
  else {
    live = { ...live };

    for (const [key, value] of Object.entries(event.live)) {
      if (value === null) delete live[key];
      else live[key] = value;
    }
  }

  publish();
}

let stream: AbortController | null = null;
let opened = false;

/**
 * Reads the live stream with fetch, since EventSource can't send the management key. Like
 * EventSource, a stream that ends or fails connects again; each new connection takes a fresh
 * snapshot and refetches.
 */
async function connect() {
  const own = new AbortController();

  stream = own;

  try {
    const response = await request('/events', { signal: own.signal });

    if (!response.ok || !response.body) throw new Error(`stream answered ${response.status}`);

    if (opened) invalidate(() => true);

    opened = true;
    connected = true;
    publish();

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += chunk.value;

      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const data = buffer
          .slice(0, end)
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');

        buffer = buffer.slice(end + 2);

        if (data) apply(JSON.parse(data));
      }
    }
  } catch {
    if (own.signal.aborted) return;
  }

  connected = false;
  publish();

  if (stream !== own) return;
  stream = null;
  setTimeout(() => {
    if (!stream && !document.hidden && liveListeners.size) void connect();
  }, 3000);
}

/**
 * A hidden tab gives its stream back: browsers allow six connections per host over HTTP/1.1, so
 * six open tabs would otherwise starve every request. Showing the tab again reconnects, takes a
 * fresh snapshot and refetches.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stream?.abort();
    stream = null;
    connected = false;
    publish();
  } else if (!stream && liveListeners.size) void connect();
});

export function useLive<K extends string>(key: K): LiveOf<K> | undefined {
  // SAFETY: the key prefix decides the value's shape on deck's server (types.ts LiveKey).
  return useSyncExternalStore(subscribe, () => live[key]) as LiveOf<K> | undefined;
}

/** Every live value whose key starts with the prefix, as [key without the prefix, value], in deck's order. */
export function useLiveList<P extends 's:' | 'a:' | 'app:'>(
  prefix: P
): [string, LiveOf<`${P}x`>][] {
  const list = useSyncExternalStore(subscribe, () => {
    const cached = lists.get(prefix);

    if (cached?.from === live) return cached.list;

    const next = Object.keys(live)
      .filter((k) => k.startsWith(prefix))
      .map((k): [string, LiveValue] => [k.slice(prefix.length), live[k]]);

    lists.set(prefix, { from: live, list: next });

    return next;
  });

  // SAFETY: as in useLive, the prefix decides the shape.
  return list as [string, LiveOf<`${P}x`>][];
}

export const useConnected = () => useSyncExternalStore(subscribe, () => connected);

/** Which session state a row or list leads with when it holds several. */
export const LIVE_ORDER = { blocked: 0, working: 1, idle: 2 } as const satisfies Record<
  LiveState,
  number
>;

/** The pool's accounts in its routing order, and one name for any account id. */
export function useAccounts() {
  const pool = useLive('pool');
  const order = pool?.order ?? [];
  const rank = (id: string) => order.indexOf(id) + 1 || order.length + 1;

  const accounts = useLiveList('a:')
    .map(([, a]) => a)
    .sort((a, b) => rank(a.id) - rank(b.id));

  const name = (id: string | null) =>
    id && id !== 'none' ? (accounts.find((a) => a.id === id)?.label ?? id) : 'No account';

  return { accounts, pool, name };
}

/** The page's query params, and a setter where null or "" removes one; typing replaces the entry. */
export function useParams() {
  const [params, setSearchParams] = useSearchParams();

  const set = useCallback(
    (patch: Record<string, string | null>, replace = false) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);

          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }

          return next;
        },
        { replace }
      ),
    [setSearchParams]
  );

  return [params, set] as const;
}

export type SetParams = ReturnType<typeof useParams>[1];
