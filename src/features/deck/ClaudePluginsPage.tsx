import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { send, useConnected, useDeck, useLiveList } from './api';
import { Empty } from './components';
import { messageOf, notify } from './actions';
import { filesUrl } from './files/urls';
import type { LiveSession, Plugin } from './types';
import './deck.scss';
import './plugins.scss';

const CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  t3: 'T3 Code',
  buzz: 'Buzz',
  voice: 'Voice',
};

const label = (name: string) => CHANNEL_LABEL[name] ?? name;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How hex is wired: the channels that reach it, the hub, and everything each new session loads. */
export function ClaudePluginsPage() {
  const list = useDeck<Plugin[]>('/plugins', 'plugins');
  const connected = useConnected();
  const sessions = useLiveList('s:').map(([, s]) => s);
  const plugins = list.data ?? [];
  const of = (kind: Plugin['kind']) => plugins.filter((p) => p.kind === kind);
  const channels = of('channel');
  const claude = of('claude');
  const mcp = of('mcp');
  const skills = of('skill');
  const hooks = of('hook');
  const mods = of('mod');
  const up = channels.filter((p) => p.state === 'connected').length;
  const on = claude.filter((p) => p.enabled).length;

  return (
    <div className="deck plugins">
      <header className="head">
        <div>
          <h1>Claude plugins</h1>
          <p className="lede">
            {list.data
              ? `${up} of ${channels.length} channels connected · ${on} of ${claude.length} plugins on · ${plural(mcp.length, 'MCP server')} · ${plural(skills.length, 'skill')}`
              : 'What every hex session loads'}
          </p>
        </div>
        <span className="pl-live">
          <span className={connected ? 'dot live' : 'dot idle'} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </header>

      {list.error && <Empty>{list.error}</Empty>}
      {!list.data && !list.error && <Empty>Reading hex's setup…</Empty>}

      {list.data && (
        <>
          <Wiring
            channels={channels}
            sessions={sessions}
            loads={[
              ['Plugins', `${on} on`, '#pl-plugins'],
              ['MCP servers', String(mcp.filter((m) => m.enabled).length), '#pl-mcp'],
              ['Skills', String(skills.length), '#pl-skills'],
              ['Hooks', String(hooks.length), '#pl-hooks'],
              ...mods.map((m): [string, string, string] => [m.name, 'mod', '#pl-mods']),
            ]}
          />

          <Group id="pl-plugins" title="Claude Code plugins" about="Installed for you. A switch turns one on or off for every new session.">
            <ul className="pl-cards">
              {claude.map((p) => (
                <PluginCard key={`${p.id}:${p.enabled}`} plugin={p} />
              ))}
            </ul>
          </Group>

          <Group id="pl-mcp" title="MCP servers" about="Tools sessions can call. hex's come from its .mcp.json; yours from Claude Code's own settings.">
            <ul className="pl-rows">
              {mcp.map((p) => (
                <li key={p.id} className="pl-row">
                  <span className={p.enabled ? 'dot live' : 'dot idle'} role="img" aria-label={p.enabled ? 'on' : 'off'} />
                  <span className="pl-row-name">{p.name}</span>
                  <span className="pl-tag">{p.scope === 'hex' ? 'hex' : 'you'}</span>
                  <span className="mono muted clip" title={p.description}>
                    {p.description}
                  </span>
                  <span className="muted small">{p.enabled ? p.state : 'turned off'}</span>
                </li>
              ))}
            </ul>
          </Group>

          <Skills skills={skills} />

          <Group id="pl-hooks" title="Hooks" about="Commands Claude Code runs on an event, before the model sees it.">
            <ul className="pl-rows">
              {hooks.map((p) => (
                <li key={p.id} className="pl-row pl-hook">
                  <span className="pl-row-name">{p.name}</span>
                  <span className="pl-tag">{p.scope === 'hex' ? 'hex' : 'you'}</span>
                  <span className="pl-hook-what">
                    <span className="clip">{hookSummary(p.description)}</span>
                    <span className="mono muted small clip" title={p.description}>
                      {p.state ? `on ${p.state}` : 'on every event'}
                    </span>
                  </span>
                  {p.source ? <SourceLink source={p.source} /> : <span />}
                </li>
              ))}
            </ul>
          </Group>

          {mods.length > 0 && (
            <Group id="pl-mods" title="Mods" about="Changes to hex's own behavior, shipped in hex core.">
              <ul className="pl-rows">
                {mods.map((p) => (
                  <li key={p.id} className="pl-row pl-hook">
                    <span className="pl-row-name">{p.name}</span>
                    {p.version ? <span className="mono muted">{p.version}</span> : <span />}
                    <span className="muted clip">{p.description || 'No description in its folder'}</span>
                    {p.source && <SourceLink source={p.source} />}
                  </li>
                ))}
              </ul>
            </Group>
          )}
        </>
      )}
    </div>
  );
}

function Group({ id, title, about, children }: { id: string; title: string; about: string; children: ReactNode }) {
  return (
    <section id={id} className="section pl-group" aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <span className="sub">{about}</span>
      </div>
      {children}
    </section>
  );
}

function SourceLink({ source }: { source: NonNullable<Plugin['source']> }) {
  return (
    <Link className="pl-source" to={filesUrl.browse(source.repo, source.path)} title={`${source.repo}/${source.path}`}>
      Source
    </Link>
  );
}

/**
 * The map: each channel on the left with its threads now, wired into the hub, which starts a
 * Claude Code session per thread, wired out to what that session loads.
 */
function Wiring({
  channels,
  sessions,
  loads,
}: {
  channels: Plugin[];
  sessions: LiveSession[];
  loads: [name: string, value: string, href: string][];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; on: boolean }[]>([]);
  const threads = sessions.filter((s) => s.app);

  useLayoutEffect(() => {
    const root = box.current;

    if (!root) return;

    const draw = () => {
      const frame = root.getBoundingClientRect();
      const hub = root.querySelector('.pl-hub')?.getBoundingClientRect();

      if (!hub || frame.width < 720) return setPaths([]);

      const y = (r: DOMRect) => r.top + r.height / 2 - frame.top;
      const curve = (x1: number, y1: number, x2: number, y2: number) => {
        const mid = (x1 + x2) / 2;

        return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      };
      const into = [...root.querySelectorAll<HTMLElement>('.pl-channel')].map((el) => {
        const r = el.getBoundingClientRect();

        return {
          d: curve(r.right - frame.left, y(r), hub.left - frame.left, y(hub)),
          on: el.dataset.on === 'true',
        };
      });
      const out = [...root.querySelectorAll<HTMLElement>('.pl-load')].map((el) => {
        const r = el.getBoundingClientRect();

        return { d: curve(hub.right - frame.left, y(hub), r.left - frame.left, y(r)), on: true };
      });

      setPaths([...into, ...out]);
    };

    draw();
    const observer = new ResizeObserver(draw);

    observer.observe(root);

    return () => observer.disconnect();
  }, [channels.length, loads.length]);

  return (
    <section className="section pl-wiring" aria-labelledby="wiring-title">
      <div className="section-head">
        <h2 id="wiring-title">How you reach hex</h2>
        <span className="sub">
          Each channel hands its threads to hex's hub, which runs one Claude Code session per thread.
        </span>
      </div>
      <div className="pl-map" ref={box}>
        <svg className="pl-wires" aria-hidden>
          {paths.map((p, i) => (
            <path key={i} d={p.d} className={p.on ? 'on' : 'off'} />
          ))}
        </svg>
        <ul className="pl-channels" aria-label="Channels">
          {channels.map((c) => {
            const mine = threads.filter((s) => s.app === c.name);
            const count = (state: LiveSession['state']) => mine.filter((s) => s.state === state).length;
            const live = c.state === 'connected';

            return (
              <li key={c.id} className="pl-channel" data-on={live}>
                <div className="pl-channel-top">
                  <span className={live ? 'dot live' : 'dot'} />
                  <b>{label(c.name)}</b>
                  {c.version && <span className="mono muted">{c.version}</span>}
                  <span className="spacer" />
                  {c.source && <SourceLink source={c.source} />}
                </div>
                <div className="pl-channel-meta">
                  {live ? (
                    mine.length ? (
                      <Link to="/live">
                        {plural(mine.length, 'thread')} open
                        {count('working') > 0 && <span> · {count('working')} working</span>}
                        {count('blocked') > 0 && <span className="pl-waiting"> · {count('blocked')} waiting on you</span>}
                      </Link>
                    ) : (
                      <span className="muted">connected, no threads open</span>
                    )
                  ) : (
                    <span className="pl-down">{c.state === 'set up' ? 'set up, hub not connected' : 'installed, never set up'}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="pl-hub">
          <b>hex hub</b>
          <span className="muted small">one session per thread</span>
          <span className="pl-hub-count">
            <span className="num">{threads.length}</span> sessions now
          </span>
        </div>
        <ul className="pl-loads" aria-label="Every session loads">
          <li className="pl-loads-title muted small">Every session loads</li>
          {loads.map(([name, value, href]) => (
            <li key={name} className="pl-load">
              <a href={href} onClick={(e) => jump(e, href)}>
                <span>{name}</span>
                <span className="num muted">{value}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * What a hook command does, in words where it's a fixed answer (`echo '{…"behavior":"allow"…}'`),
 * else the script it runs.
 */
function hookSummary(command: string) {
  const answer = /^echo '(.*)'$/.exec(command.trim())?.[1];

  if (answer) {
    try {
      const behavior = JSON.parse(answer)?.hookSpecificOutput?.decision?.behavior;

      if (typeof behavior === 'string') return `Answers “${behavior}” without asking`;
    } catch {
      // Not JSON: show the command itself.
    }
  }

  return command.replace(/\/home\/[^/]+/g, '~').replace(/"\$HOME/g, '"~');
}

/** In-page links under a hash router: scroll to the section instead of routing. */
const jump = (event: React.MouseEvent, href: string) => {
  event.preventDefault();
  document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function PluginCard({ plugin }: { plugin: Plugin }) {
  const [enabled, setEnabled] = useState(plugin.enabled === true);
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    setBusy(true);

    try {
      await send(`/plugins/${encodeURIComponent(plugin.id)}`, 'POST', { enabled: next });
      notify(`${plugin.name} is ${next ? 'on' : 'off'} for new sessions`);
    } catch (error) {
      setEnabled(!next);
      notify(messageOf(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="pl-card" data-on={enabled}>
      <div className="pl-card-top">
        <b className="clip">{plugin.name}</b>
        <ToggleSwitch checked={enabled} disabled={busy} onChange={toggle} ariaLabel={`${plugin.name} for new sessions`} />
      </div>
      <p className="muted">{plugin.description || 'No description in its manifest.'}</p>
      <div className="pl-card-foot muted small">
        {plugin.version && <span className="mono">{plugin.version}</span>}
        {plugin.state && <span className="clip">{plugin.state}</span>}
        {plugin.scope && plugin.scope !== 'user' && <span>{plugin.scope}</span>}
      </div>
    </li>
  );
}

const SKILLS_SHOWN = 12;

function Skills({ skills }: { skills: Plugin[] }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    : skills;
  const shown = all || q ? found : found.slice(0, SKILLS_SHOWN);
  const hex = skills.filter((s) => s.scope === 'hex').length;

  return (
    <Group
      id="pl-skills"
      title="Skills"
      about={`${hex} from hex's folder, ${skills.length - hex} of yours. A session reads one when its task matches the description.`}
    >
      <div className="pl-skill-bar">
        <input
          type="search"
          className="pl-search"
          placeholder={`Search ${skills.length} skills`}
          aria-label="Search skills"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <ul className="pl-skills">
        {shown.map((s) => (
          <li key={s.id} title={s.description}>
            <div className="pl-skill-name">
              <b className="clip">{s.name}</b>
              {s.scope === 'hex' && <span className="pl-tag">hex</span>}
            </div>
            <p className="muted small">{s.description || 'No description.'}</p>
          </li>
        ))}
        {!shown.length && <li className="muted">No skill matches “{query}”.</li>}
      </ul>
      {!q && found.length > SKILLS_SHOWN && (
        <button type="button" className="pl-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${found.length}`}
        </button>
      )}
    </Group>
  );
}
