import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentStatus, RealmSnapshot, RpgAgent } from './types';
import { staticPreviewSnapshot } from './lib/staticPreview';
import './index.css';

const statusOrder: AgentStatus[] = ['active', 'waiting', 'blocked', 'failed', 'completed', 'idle', 'sleeping', 'unknown'];
const githubRepositoryUrl = 'https://github.com/Michaelunkai/AgentsGameSystem';
const liveRefreshMs = 4000;

interface LiveObserverConfig {
  enabled: boolean;
  observerUrl?: string;
  updatedAtIso?: string;
  note?: string;
}

interface AgentCluster {
  key: string;
  title: string;
  biome: string;
  glyph: string;
  agents: RpgAgent[];
  activeCount: number;
  dangerCount: number;
  x: number;
  y: number;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return 'unknown';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatFreshness(iso?: string): string {
  if (!iso) return 'scanning';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'live now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
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

const clusterPositions: Record<string, Pick<AgentCluster, 'title' | 'biome' | 'glyph' | 'x' | 'y'>> = {
  codex: { title: 'Codex Forge Circle', biome: 'Silver Forge City', glyph: '⚒', x: 23, y: 58 },
  claude: { title: 'Claude Archive Choir', biome: 'Moonlit Archive', glyph: '§', x: 68, y: 24 },
  openclaw: { title: 'OpenClaw Herald Gate', biome: 'Signal Harbor', glyph: '◈', x: 79, y: 66 },
  ollama: { title: 'Ollama Dragon Peak', biome: 'GPU Crystal Mountain', glyph: '♜', x: 45, y: 18 },
  browser: { title: 'Browser Ranger Watch', biome: 'Portal Canopy', glyph: '⌖', x: 37, y: 76 },
  telegram: { title: 'Telegram Horn Tower', biome: 'Message Coast', glyph: '⚑', x: 88, y: 42 },
  docker: { title: 'Docker Brass Docks', biome: 'Container Harbor', glyph: '⬢', x: 57, y: 82 },
  powershell: { title: 'PowerShell Rune Hall', biome: 'Command Citadel', glyph: '✦', x: 15, y: 31 },
  node: { title: 'Node Clockwork Grove', biome: 'Service Grove', glyph: '⚙', x: 55, y: 49 },
  'local-service': { title: 'Local Service Bastion', biome: 'Loopback Keep', glyph: '⬟', x: 72, y: 51 },
  manual: { title: 'Manual Charter Camp', biome: 'Charter Field', glyph: '◌', x: 28, y: 20 },
  unknown: { title: 'Unknown Traveler Road', biome: 'Fog Road', glyph: '◆', x: 50, y: 62 }
};

function buildClusters(agents: RpgAgent[]): AgentCluster[] {
  const groups = new Map<string, RpgAgent[]>();
  agents.forEach((agent) => {
    const key = agent.type in clusterPositions ? agent.type : 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  });
  return Array.from(groups.entries())
    .map(([key, clusterAgents]) => {
      const defaults = clusterPositions[key];
      return {
        key,
        ...defaults,
        agents: clusterAgents,
        activeCount: clusterAgents.filter((agent) => agent.status === 'active').length,
        dangerCount: clusterAgents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed').length
      };
    })
    .sort((left, right) => right.agents.length - left.agents.length);
}

function ClusterNode({
  cluster,
  selected,
  onSelect
}: {
  cluster: AgentCluster;
  selected: boolean;
  onSelect: (cluster: AgentCluster) => void;
}) {
  const aura = cluster.dangerCount ? 'danger' : cluster.activeCount ? 'active' : 'quiet';
  return (
    <button
      className={`cluster-node ${aura} ${selected ? 'selected' : ''}`}
      style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
      onClick={() => onSelect(cluster)}
      aria-label={`Inspect ${cluster.title}`}
    >
      <span className="cluster-glyph" aria-hidden="true">{cluster.glyph}</span>
      <strong>{cluster.agents.length}</strong>
      <span>{cluster.title}</span>
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
      <p className="live-action"><strong>Live RPG action:</strong> {agent.liveAction}</p>
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
          <dt>PID</dt><dd>{agent.signal.pid ?? 'not exposed'}</dd>
          <dt>Uptime</dt><dd>{formatDuration(agent.signal.uptimeSeconds)}</dd>
          <dt>Last seen</dt><dd>{formatFreshness(agent.signal.lastSeenIso)}</dd>
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

function AgentMenu({
  agents,
  selectedId,
  search,
  onSearch,
  filter,
  onFilter,
  onSelect
}: {
  agents: RpgAgent[];
  selectedId?: string;
  search: string;
  filter: AgentStatus | 'all';
  onSearch: (search: string) => void;
  onFilter: (filter: AgentStatus | 'all') => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="agent-nav" aria-label="Running agents and sessions">
      <div className="agent-nav-title">
        <p className="eyebrow">Running Sessions</p>
        <h2>{agents.length} live</h2>
      </div>
      <label className="search-field">
        Find agent
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="codex, browser, node..." />
      </label>
      <label className="search-field">
        Status
        <select value={filter} onChange={(event) => onFilter(event.target.value as AgentStatus | 'all')}>
          <option value="all">All currently running</option>
          {statusOrder.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <div className="agent-menu-list" role="listbox" aria-label="Every currently running detected agent">
        {agents.map((agent) => (
          <button
            key={agent.id}
            className={`agent-menu-item ${agent.status} ${agent.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(agent.id)}
            role="option"
            aria-selected={agent.id === selectedId}
          >
            <span className={`mini-orb ${agent.aura}`}><Glyph portrait={agent.portrait} /></span>
            <span>
              <strong>{agent.name}</strong>
              <em>{agent.className} · {agent.signal.processName ?? agent.type}</em>
              <small>{agent.liveAction}</small>
            </span>
            <i>{agent.status}</i>
          </button>
        ))}
        {!agents.length && (
          <div className="no-menu-results">
            <strong>No running agents match this view.</strong>
            <p>Clear filters or start a local agent process; configured-but-stopped sources are intentionally hidden.</p>
          </div>
        )}
      </div>
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
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionMode, setConnectionMode] = useState('local observer pending');
  const isLocalObserverHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  const fetchLiveObserverSnapshot = useCallback(async (): Promise<RealmSnapshot | undefined> => {
    const configResponse = await fetch(`/live-observer.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!configResponse.ok) return undefined;
    const config = await configResponse.json() as LiveObserverConfig;
    if (!config.enabled || !config.observerUrl) return undefined;
    const observerUrl = config.observerUrl.replace(/\/$/, '');
    const realmResponse = await fetch(`${observerUrl}/api/realm`, { cache: 'no-store' });
    if (!realmResponse.ok) throw new Error(`live Windows observer returned ${realmResponse.status}`);
    setConnectionMode(`live Windows observer via ${observerUrl}`);
    return await realmResponse.json() as RealmSnapshot;
  }, []);

  const refresh = useCallback(async () => {
    if (paused) return;
    if (!isLocalObserverHost) {
      try {
        const liveSnapshot = await fetchLiveObserverSnapshot();
        if (liveSnapshot) {
          setSnapshot(liveSnapshot);
          setSelectedId((current) => liveSnapshot.agents.some((agent) => agent.id === current) ? current : liveSnapshot.agents[0]?.id);
          setError(undefined);
          return;
        }
        setConnectionMode('static preview: no live observer URL configured');
        setSnapshot(staticPreviewSnapshot());
        setError('No live Windows observer is configured for this deployment.');
      } catch (liveError) {
        setConnectionMode('static preview: live observer unreachable');
        setError(liveError instanceof Error ? liveError.message : 'live observer unreachable');
        setSnapshot((current) => current ?? staticPreviewSnapshot());
      }
      return;
    }
    try {
      const response = await fetch('/api/realm', { cache: 'no-store' });
      if (!response.ok) throw new Error(`observer returned ${response.status}`);
      const data = await response.json() as RealmSnapshot;
      setConnectionMode('live local Windows observer');
      setSnapshot(data);
      setSelectedId((current) => data.agents.some((agent) => agent.id === current) ? current : data.agents[0]?.id);
      setError(undefined);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'unknown observer failure');
      setSnapshot((current) => current ?? staticPreviewSnapshot());
    }
  }, [fetchLiveObserverSnapshot, isLocalObserverHost, paused]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), liveRefreshMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const agents = useMemo(() => {
    const list = snapshot?.agents ?? [];
    const normalizedSearch = search.trim().toLowerCase();
    return list.filter((agent) => {
      const matchesStatus = filter === 'all' || agent.status === filter;
      const haystack = `${agent.name} ${agent.type} ${agent.className} ${agent.liveAction} ${agent.signal.processName ?? ''}`.toLowerCase();
      return matchesStatus && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [snapshot, filter, search]);
  const clusters = useMemo(() => buildClusters(agents), [agents]);
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
          <a className="github-link" href={githubRepositoryUrl} target="_blank" rel="noreferrer" aria-label="Open GitHub repository in a new tab">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.33-3.76-1.33-.5-1.29-1.24-1.63-1.24-1.63-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1 2.63.4 3.2-.77.1-.72.39-1.2.7-1.48-2.47-.28-5.08-1.24-5.08-5.52 0-1.22.43-2.21 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.6 10.6 0 0 1 5.62 0c2.13-1.45 3.07-1.15 3.07-1.15.61 1.54.23 2.68.11 2.96.72.79 1.15 1.78 1.15 3 0 4.3-2.61 5.23-5.1 5.5.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" />
            </svg>
            <span>GitHub</span>
          </a>
          <button onClick={() => void refresh()}>Refresh discovery</button>
          <button className={paused ? 'danger' : ''} onClick={() => setPaused((value) => !value)}>{paused ? 'Resume watchers' : 'Pause watchers'}</button>
          <a href="/agent-realms.config.sample.json" target="_blank" rel="noreferrer">Sample config</a>
        </div>
      </header>

      <TokenFreeRibbon snapshot={snapshot} />

      {error && <div className="error-banner">Observer issue: {error}. The realm remains available with the last successful state.</div>}

      <section className="control-bar">
        <div className="live-metrics" aria-label="Live observer status">
          <strong>{snapshot?.agents.length ?? 0}</strong>
          <span>currently running agents · refresh every {liveRefreshMs / 1000}s · last pulse {formatFreshness(snapshot?.generatedAtIso)}</span>
        </div>
        <strong className="connection-mode">{connectionMode}</strong>
        <div className="discovery-notes">
          {(snapshot?.discoveryNotes ?? ['Loading discovery adapters...']).map((note) => <span key={note}>{note}</span>)}
        </div>
      </section>

      <section className="realm-layout">
        <AgentMenu
          agents={agents}
          selectedId={selected?.id}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          onSelect={setSelectedId}
        />

        <div className="map-panel">
          <div className="map-header">
            <div>
              <p className="eyebrow">Moonlit Operations Map</p>
              <h2>{clusters.length ? `${clusters.length} ecosystems, ${agents.length} agents` : 'No live agents yet'}</h2>
            </div>
            <span>{snapshot ? new Date(snapshot.generatedAtIso).toLocaleTimeString() : 'scanning...'}</span>
          </div>
          <div className="world-map" role="region" aria-label="Agent ecosystem map">
            <div className="moon-disc" />
            <div className="route route-a" />
            <div className="route route-b" />
            <div className="route route-c" />
            <div className="biome biome-forge">Silver Forge City</div>
            <div className="biome biome-archive">Moonlit Archive</div>
            <div className="biome biome-harbor">Signal Harbor</div>
            <div className="biome biome-mountain">GPU Crystal Mountain</div>
            {clusters.map((cluster) => (
              <ClusterNode
                key={cluster.key}
                cluster={cluster}
                selected={cluster.agents.some((agent) => agent.id === selected?.id)}
                onSelect={(selectedCluster) => setSelectedId(selectedCluster.agents[0]?.id)}
              />
            ))}
            {!agents.length && <div className="guided-setup">Add manual agents in <code>agent-realms.config.json</code> or start local tools; missing sources become sleeping travelers instead of crashes.</div>}
          </div>
          <div className="ecosystem-strip">
            {clusters.map((cluster) => (
              <button key={cluster.key} className={cluster.agents.some((agent) => agent.id === selected?.id) ? 'active' : ''} onClick={() => setSelectedId(cluster.agents[0]?.id)}>
                <span>{cluster.glyph}</span>
                <strong>{cluster.title}</strong>
                <em>{cluster.agents.length} running · {cluster.activeCount} active</em>
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
