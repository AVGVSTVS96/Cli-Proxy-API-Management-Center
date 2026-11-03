/** The shapes the proxy's deck views send (internal/usage/deck in the proxy); keep the two in step. */

export type Range = 'today' | 'yesterday' | '7d' | '30d' | '6m';

export type GroupBy =
  | 'agent'
  | 'session'
  | 'project'
  | 'model'
  | 'harness'
  | 'entrypoint'
  | 'device'
  | 'account';

export type Measure = 'tokens' | 'api' | 'plan' | 'fiveHour' | 'week';

export type Dimension =
  | 'app'
  | 'harness'
  | 'entrypoint'
  | 'model'
  | 'project'
  | 'device'
  | 'account';

export type UsageQuery = {
  range: Range;
  by: GroupBy;
  measure: Measure;
  where: Partial<Record<Dimension, string[]>>;
  search: string;
  limit: number;
  /** Only rows under this agent row key, so a row drills into its sessions. */
  within: string | null;
};

export type Amount = {
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  requests: number;
  apiUsd: number;
  planUsd: number;
  unpricedTokens: number;
};

/** Percentage points of account limits, summed over accounts and windows. Null: nothing to estimate from. */
export type Points = { fiveHour: number | null; week: number | null };

export type AccountPoints = { account: string } & Points;

/** Who a usage row belongs to. Threads are keyed by app and thread id; a name alone never joins. */
export type Who =
  | { kind: 'thread'; app: string; thread: string; name: string; href: string | null }
  | { kind: 'job'; owner: string | null; unit: string }
  | { kind: 'session'; title: string; project: string; href: string | null }
  | { kind: 'action'; repo: string; workflow: string; run: string | null; href: string }
  | { kind: 'project'; project: string };

export type LiveState = 'working' | 'idle' | 'blocked';

export type UsageRow = {
  key: string;
  label: string;
  detail: string;
  who: Who | null;
  /** Categorical slot 0 to 6 for the top rows by API value in the unfiltered range, 7 for the rest. */
  color: number;
  amount: Amount;
  points: Points;
  byAccount: AccountPoints[];
  sessions: number;
  lastActiveAt: number;
  /** The chosen measure per bucket of `UsageView.buckets`. */
  series: number[];
  live: LiveState | null;
  /** How its sessions' Claude Code was started (cli, sdk-cli, t3-code...); 'mixed' when they differ. */
  entrypoint: string;
  /** Share of its API value that ran on the Agent SDK or `claude -p`, 0 to 1. */
  agentSdk: number;
};

/** Agent SDK and `claude -p` usage, which the five-hour meter charges `factor` times interactive. */
export type AgentSdkUsage = { apiUsd: number; share: number; fiveHour: number | null; factor: number };

export type Totals = Amount & { sessions: number; cacheHitRate: number; points: Points };

export type Bucket = { at: number; size: '1h' | '4h' | '1d' | '1w' };

export type UsageView = {
  query: UsageQuery;
  period: { from: number; to: number; timezone: string };
  totals: Totals;
  previous: Totals | null;
  buckets: Bucket[];
  /** Top seven groups plus the rest, in the chosen measure, one value per bucket. */
  series: { key: string; label: string; color: number; values: number[] }[];
  rows: UsageRow[];
  rowCount: number;
  coverage: {
    namedApiUsd: number;
    totalApiUsd: number;
    limitsSince: number | null;
    unassigned: { account: string; kind: 'fiveHour' | 'week'; points: number }[];
  };
  facets: Record<Dimension, { id: string; label: string; count: number }[]>;
  sources: {
    devices: { id: string; label: string; syncedAt: number | null }[];
  };
  agentSdk: AgentSdkUsage;
};

export type LimitWindow = {
  used: number | null;
  cutoff: number;
  resetsAt: number | null;
  sampledAt: number | null;
  /** Share of the window already passed, 0 to 1, so pace reads at a glance. */
  elapsed: number | null;
};

export type Account = {
  id: string;
  label: string;
  plan: string;
  /** When the account's current plan started, from the pool's plan record; not when it joined the pool. */
  since: number | null;
  signInUntil: number | null;
  rank: number | null;
  standing: 'next' | 'open' | 'tight' | 'limited' | 'signed-out';
  reasons: string[];
  fiveHour: LimitWindow;
  week: LimitWindow;
  working: number;
  idle: number;
  heldResets: { kind: string; left: number; expiresAt: number | null }[];
  atLimit: { available: boolean; nextAt: number | null } | null;
};

export type Policy = { sessionCutoff: number; weeklyCutoff: number; agentsPerAccount: number };

export type Pool = {
  next: string | null;
  decision: string;
  order: string[];
  policy: Policy;
  revision: string;
  notes: string[];
};

export type PolicyResult = { pool: Pool; saved: boolean; conflict: boolean };

export type MoveCause = 'limit' | 'over' | 'early' | 'restart' | 'start';

export type Move = {
  at: number;
  session: string;
  label: string | null;
  from: string | null;
  to: string;
  cause: MoveCause;
};

export type AccountsView = {
  history: { account: string; kind: 'fiveHour' | 'week'; points: [at: number, used: number][] }[];
  moves: Move[];
  hosts: { host: string; seenAt: number | null; seats: number }[];
};

export type LiveSession = {
  id: string;
  label: string;
  /** The `UsageRow.key` this session ranks under with `by: "agent"`. */
  row: string;
  app: string | null;
  state: LiveState;
  account: string | null;
  host: string;
  cwd: string;
  since: number;
  entrypoint: string;
};

export type LiveKey = `s:${string}` | `a:${string}` | 'pool' | `app:${string}`;

export type LiveValue = LiveSession | Account | Pool | { connected: boolean };

/**
 * One stream per tab. `snapshot` opens every connection; `patch` carries only keys whose value changed
 * (null removes one); `stale` names fetched resources to refetch, such as "usage" or "repo:hex".
 */
export type ServerEvent =
  | { type: 'snapshot'; live: Record<string, LiveValue> }
  | { type: 'patch'; live: Record<string, LiveValue | null> }
  | { type: 'stale'; tags: string[] };

/** Files, Plugins and Executor: the proxy's workspace views (internal/workspace in the proxy). */

export type Workspace = {
  /** The repo id for its live checkout, `<repo>~<name>` for a worktree. */
  id: string;
  repo: string;
  /** Null for the live checkout. */
  name: string | null;
  path: string;
  branch: string | null;
  base: string | null;
};

export type RepoSummary = {
  id: string;
  name: string;
  about: string;
  path: string;
  review: boolean;
  branch: string | null;
  unpushed: number | null;
  /** The live checkout first, then its worktrees. */
  workspaces: Workspace[];
};

export type ChangeStatus = 'added' | 'deleted' | 'modified' | 'untracked';

export type Change = { path: string; status: ChangeStatus; added: number; removed: number };

export type Changes = { files: Change[]; dirty: boolean; ahead: number; behind: number };

export type WorkspaceDiff = { patch: string; omitted: string[] };

export type FileBody = {
  path: string;
  contents: string | null;
  original: string | null;
  binary: boolean;
  tooLarge: boolean;
};

export type Commit = {
  sha: string;
  short: string;
  subject: string;
  author: string;
  at: number;
  signed: boolean;
};

export type CommitDetail = Commit & { body: string; patch: string; truncated?: boolean };

export type Draft = { name: string; target: { repo: string; path: string } | null };

export type Plugin = {
  id: string;
  name: string;
  kind: 'channel' | 'mod' | 'claude' | 'mcp' | 'skill' | 'hook';
  version: string | null;
  description: string;
  enabled: boolean | null;
  scope: string | null;
  source: { repo: string; path: string } | null;
  state: string | null;
};

export type ExecutorApp = {
  id: string;
  slug: string;
  name: string;
  activeVersion: string | null;
  deployedAt: string | null;
  versions: number;
  local: boolean;
  pinned: string | null;
  requirements: string[];
  accounts: { requirement: string; label: string; health: string | null }[];
};

export type ExecutorOverview = { framework: string | null; apps: ExecutorApp[]; console: string };

export type ExecutorSource = {
  files: { path: string; deployed: string | null; local: string | null }[];
};
