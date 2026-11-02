import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { send, useConnected, useDeck } from './api';
import { Empty } from './components';
import { messageOf, notify } from './actions';
import { filesUrl } from './files/urls';
import type { Plugin } from './types';
import './deck.scss';
import './workspace.scss';

const GROUPS: { kind: Plugin['kind']; title: string; about: string }[] = [
  {
    kind: 'channel',
    title: 'Channels',
    about:
      "How you reach hex. hex's hub starts each session with its channel, so they stay off in Claude Code's own list.",
  },
  { kind: 'mod', title: 'Mods', about: "Changes to hex's own behavior, shipped in hex core." },
  {
    kind: 'claude',
    title: 'Claude Code plugins',
    about: 'Installed for your user. A switch turns one on or off for every new session.',
  },
];

/** What every new Claude Code session loads: hex's channels and mods, and the user's plugins. */
export function ClaudePluginsPage() {
  const list = useDeck<Plugin[]>('/plugins', 'plugins');
  const connected = useConnected();
  const plugins = list.data ?? [];
  const of = (kind: Plugin['kind']) => plugins.filter((p) => p.kind === kind);
  const on = of('claude').filter((p) => p.enabled).length;
  const reachable = of('channel').filter((p) => p.state === 'connected').length;

  return (
    <div className="deck workspace plugins">
      <header className="head">
        <div>
          <h1>Claude plugins</h1>
          <p className="lede">
            {list.data
              ? `${on} of ${of('claude').length} plugins on · ${reachable} of ${of('channel').length} channels connected`
              : 'What every new session loads'}
          </p>
        </div>
        <span className="live-state">
          <span className={connected ? 'dot live' : 'dot idle'} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </header>
      {list.error && <Empty>{list.error}</Empty>}
      {!list.data && !list.error && <Empty>Reading plugins…</Empty>}
      {GROUPS.map((group) => {
        const items = of(group.kind);

        if (!items.length) return null;

        return (
          <section key={group.kind} className="section">
            <div className="section-head">
              <h2>{group.title}</h2>
              <span className="sub">{group.about}</span>
            </div>
            <ul className="plugin-list">
              {items.map((p) => (
                <PluginRow key={`${p.id}:${p.enabled}`} plugin={p} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PluginRow({ plugin }: { plugin: Plugin }) {
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

  const source = plugin.source;

  return (
    <li className="plugin">
      <div className="plugin-main">
        <div className="plugin-title">
          <span className="name">{plugin.name}</span>
          {plugin.version && <span className="mono muted">{plugin.version}</span>}
          {plugin.kind === 'channel' && plugin.state && (
            <span className="chip">
              <span className={plugin.state === 'connected' ? 'dot live' : 'dot idle'} />
              {plugin.state}
            </span>
          )}
          {plugin.kind === 'claude' && plugin.state && <span className="muted small">{plugin.state}</span>}
        </div>
        {plugin.description && <p className="muted">{plugin.description}</p>}
      </div>
      <div className="plugin-side">
        {source && (
          <Link className="small" to={filesUrl.browse(source.repo, source.path)}>
            Source in {source.repo} →
          </Link>
        )}
        {plugin.kind === 'claude' && (
          <ToggleSwitch
            checked={enabled}
            disabled={busy}
            onChange={toggle}
            ariaLabel={`${plugin.name} for new sessions`}
          />
        )}
      </div>
    </li>
  );
}
