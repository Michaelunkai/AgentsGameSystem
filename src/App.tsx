import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentStatus, RealmSnapshot, RpgAgent } from './types';
import { staticPreviewSnapshot } from './lib/staticPreview';
import './index.css';

const statusOrder: AgentStatus[] = ['active', 'waiting', 'blocked', 'failed', 'completed', 'idle', 'sleeping', 'unknown'];

function formatDuration(seconds?: number): string {
  if (!seconds) return 'unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function Glyph({ portrait }: { portrait: string }) {
  const glyphs: Record<string, string> = {
    hammer: '⚒',
    scroll: '§',
    horn: '◈',
    dragon: '♜',
    compass: '⌖',
    lyre: '♫',
    anvil: '⬢',
    wand: '✦',
    gear: '⚙',
    shield: '⬟',
    banner: '⚑',
    lantern: '◌'
  };
  return <span aria-hidden="true">{glyphs[portrait] ?? '◆'}</span>;
}

function AgentMarker({ agent, selected, onSelect }: { agent: RpgAgent; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      className={`agent-marker ${agent.aura} ${selected ? 'selected' : ''}`}
      style={{ left: `${agent.territory.x}%`, top: `${agent.territory.y}%` }}
      onClick={() => onSelect(agent.id)}
      aria-label={`Inspect ${agent.name}`}
    >
      <Glyph portrait={agent.portrait} />
      <span>{agent.name.split(' ')[0]}</span>
    </button>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <strong>{value}%</strong>
      <div><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function DetailPanel({ agent }: { agent?: RpgAgent }) {
  if (!agent) {
    return (
      <aside className="detail-panel empty-state">
        <h2>No traveler selected</h2>
        <p>Choose a realm character to inspect its source adapter, status reasoning, redacted logs, and local work artifacts.</p>
      </aside>
    );
  }

  return (
    <aside className={`detail-panel ${agent.aura}`}>
      <div className="character-card">
        <div className={`portrait ${agent.animation}`}><Glyph portrait={agent.portrait} /></div>
        <div>
          <p className="eyebrow">{agent.className}</p>
          <h2>{agent.name}</h2>
          <span className={`status-pill ${agent.status}`}>{agent.status}</span>
        </div>
      </div>
      <p className="quest">{agent.quest}</p>
      <div className="meters">
        <Meter label="Health" value={agent.health} />
        <Meter label="Signal confidence" value={agent.focus} />
        <Meter label={agent.resourceLabel} value={agent.resourceValue} />
      </div>
      <section>
        <h3>Why This Status?</h3>
        <ul className="plain-list">
          {agent.signal.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </section>
      <section>
        <h3>Local Evidence</h3>
        <dl className="evidence-grid">
          <dt>Source</dt><dd>{agent.signal.source}</dd>
          <dt>Process</dt><dd>{agent.signal.processName ?? 'not process-bound'}</dd>
          <dt>Uptime</dt><dd>{formatDuration(agent.signal.uptimeSeconds)}</dd>
          <dt>Ports</dt><dd>{agent.signal.ports.length ? agent.signal.ports.join(', ') : 'none'}</dd>
        </dl>
      </section>
      <section>
        <h3>Artifacts</h3>
        <ul className="artifact-list">
          {agent.signal.artifacts.length ? agent.signal.artifacts.map((artifact) => <li key={artifact}>{artifact}</li>) : <li>No file artifact exposed.</li>}
        </ul>
      </section>
      <section>
        <h3>Recent Redacted Log Lines</h3>
        <div className="log-box">
          {agent.signal.logSnippets.length ? agent.signal.logSnippets.map((line) => <code key={line}>{line}</code>) : <code>No readable configured log snippet.</code>}
        </div>
      </section>
    </aside>
  );
}

function TokenFreeRibbon({ snapshot }: { snapshot?: RealmSnapshot }) {
  return (
    <section className="token-ribbon" aria-label="Token-Free Mode proof">
      <div>
        <span className="rune-dot" />
        <strong>Token-Free Mode</strong>
        <p>No hosted LLM clients initialized. Local adapters only.</p>
      </div>
      <details>
        <summary>Proof mechanism</summary>
        <ul>
          {(snapshot?.tokenFree.proof ?? ['Loading local proof...']).map((proof) => <li key={proof}>{proof}</li>)}
        </ul>
      </details>
    </section>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState<RealmSnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (paused) return;
    try {
      const response = await fetch('/api/realm', { cache: 'no-store' });
      if (!response.ok) throw new Error(`observer returned ${response.status}`);
      const data = await response.json() as RealmSnapshot;
      setSnapshot(data);
      setSelectedId((current) => current ?? data.agents[0]?.id);
      setError(undefined);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'unknown observer failure');
      setSnapshot((current) => current ?? staticPreviewSnapshot());
    }
  }, [paused]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const agents = useMemo(() => {
    const list = snapshot?.agents ?? [];
    return filter === 'all' ? list : list.filter((agent) => agent.status === filter);
  }, [snapshot, filter]);
  const selected = snapshot?.agents.find((agent) => agent.id === selectedId) ?? agents[0];

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local AI Workforce RPG</p>
          <h1>Agent Realms</h1>
          <p className="lede">A living fantasy kingdom mapped from this Windows PC's local agent processes, folders, logs, and loopback services.</p>
        </div>
        <div className="hero-actions">
          <button onClick={() => void refresh()}>Refresh discovery</button>
          <button className={paused ? 'danger' : ''} onClick={() => setPaused((value) => !value)}>{paused ? 'Resume watchers' : 'Pause watchers'}</button>
          <a href="/agent-realms.config.sample.json" target="_blank" rel="noreferrer">Sample config</a>
        </div>
      </header>

      <TokenFreeRibbon snapshot={snapshot} />

      {error && <div className="error-banner">Observer issue: {error}. The realm remains available with the last successful state.</div>}

      <section className="control-bar">
        <label>
          Filter realm
          <select value={filter} onChange={(event) => setFilter(event.target.value as AgentStatus | 'all')}>
            <option value="all">All statuses</option>
            {statusOrder.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <div className="discovery-notes">
          {(snapshot?.discoveryNotes ?? ['Loading discovery adapters...']).map((note) => <span key={note}>{note}</span>)}
        </div>
      </section>

      <section className="realm-layout">
        <div className="map-panel">
          <div className="map-header">
            <div>
              <p className="eyebrow">Moonlit Operations Map</p>
              <h2>{agents.length ? `${agents.length} living agents` : 'No live agents yet'}</h2>
            </div>
            <span>{snapshot ? new Date(snapshot.generatedAtIso).toLocaleTimeString() : 'scanning...'}</span>
          </div>
          <div className="world-map" role="region" aria-label="Agent ecosystem map">
            <div className="route route-a" />
            <div className="route route-b" />
            <div className="biome biome-forge">Forge City</div>
            <div className="biome biome-archive">Archive</div>
            <div className="biome biome-harbor">Harbor</div>
            <div className="biome biome-mountain">GPU Mountain</div>
            {agents.map((agent) => <AgentMarker key={agent.id} agent={agent} selected={agent.id === selected?.id} onSelect={setSelectedId} />)}
            {!agents.length && <div className="guided-setup">Add manual agents in <code>agent-realms.config.json</code> or start local tools; missing sources become sleeping travelers instead of crashes.</div>}
          </div>
          <div className="roster">
            {agents.map((agent) => (
              <button key={agent.id} className={agent.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(agent.id)}>
                <Glyph portrait={agent.portrait} />
                <span>{agent.name}</span>
                <em>{agent.status}</em>
              </button>
            ))}
          </div>
        </div>

        <DetailPanel agent={selected} />
      </section>

      <section className="event-history">
        <div>
          <p className="eyebrow">Realm Event History</p>
          <h2>Real signals translated into game events</h2>
        </div>
        <div className="event-list">
          {(snapshot?.events ?? []).slice(0, 12).map((event) => (
            <article key={event.id} className={event.severity}>
              <time>{new Date(event.atIso).toLocaleTimeString()}</time>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
            </article>
          ))}
          {!snapshot?.events.length && <article><strong>Scanning realm...</strong><p>No local events loaded yet.</p></article>}
        </div>
      </section>
    </main>
  );
}

export default App;
