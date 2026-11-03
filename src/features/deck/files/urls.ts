/** Where each Files view lives: `/files/<ws>` browses, then `/file/<path>`, `/changes`, `/history/<sha>`. */

export const DRAFTS = 'drafts';

export type FilesRoute =
  | { view: 'none' }
  | { view: 'browse'; ws: string; file: string }
  | { view: 'changes'; ws: string }
  | { view: 'history'; ws: string; sha: string }
  | { view: 'drafts'; name: string };

const path = (parts: string[]) => parts.map(encodeURIComponent).join('/');

export function parseFilesRoute(splat: string): FilesRoute {
  const [ws = '', view = '', ...rest] = splat.split('/').map(decodeURIComponent);

  if (!ws) return { view: 'none' };

  if (ws === DRAFTS) return { view: 'drafts', name: [view, ...rest].filter(Boolean).join('/') };

  if (view === 'changes') return { view: 'changes', ws };

  if (view === 'history') return { view: 'history', ws, sha: rest[0] ?? '' };

  return { view: 'browse', ws, file: view === 'file' ? rest.join('/') : '' };
}

export const filesUrl = {
  browse: (ws: string, file = '') =>
    `/files/${encodeURIComponent(ws)}${file ? `/file/${path(file.split('/'))}` : ''}`,
  changes: (ws: string) => `/files/${encodeURIComponent(ws)}/changes`,
  history: (ws: string, sha = '', file = '') =>
    `/files/${encodeURIComponent(ws)}/history${sha ? `/${sha}` : ''}${file ? `?path=${encodeURIComponent(file)}` : ''}`,
  drafts: (name = '') => `/files/${DRAFTS}${name ? `/${encodeURIComponent(name)}` : ''}`,
};

/** The proxy's API paths for one workspace. */
export const wsApi = (ws: string, rest = '') => `/ws/${encodeURIComponent(ws)}${rest}`;

export const fileApi = (ws: string, file: string) => wsApi(ws, `/file?path=${encodeURIComponent(file)}`);

export const rawApi = (ws: string, file: string) => wsApi(ws, `/raw?path=${encodeURIComponent(file)}`);

/** The tags a workspace's reads refetch on: its own files and its repo's git state. */
export const wsTags = (ws: { id: string; repo: string }) => [`ws:${ws.id}`, `repo:${ws.repo}`];

/** A worktree name from a file path, such as "agents-md" for AGENTS.md. */
export const nameFor = (file: string) =>
  file
    .split('/')
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
