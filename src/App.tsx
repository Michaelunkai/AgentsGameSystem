import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentStatus, RealmEvent, RealmSnapshot, RpgAgent } from './types';
import { staticPreviewSnapshot } from './lib/staticPreview';
import './index.css';

const statusOrder: AgentStatus[] = ['active', 'waiting', 'blocked', 'failed', 'completed', 'idle', 'sleeping', 'unknown'];
const githubRepositoryUrl = 'https://github.com/Michaelunkai/AgentsGameSystem';
const liveRefreshMs = 4000;
const streamRefreshMs = 2500;

interface LiveObserverConfig {
  enabled: boolean;
  observerUrl?: string;
}

interface AgentCluster {
  key: string;
  title: string;
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
    hammer: 'HF',
    scroll: 'SC',
    horn: 'HG',
    dragon: 'DR',
    compass: 'RG',
    lyre: 'BD',
    anvil: 'AN',
    wand: 'PW',
    gear: 'ND',
    shield: 'WD',
    banner: 'BN',
    lantern: 'TR'
  };
  return <span aria-hidden="true">{glyphs[portrait] ?? 'AG'}</span>;
}

const clusterPositions: Record<string, Omit<AgentCluster, 'key' | 'agents' | 'activeCount' | 'dangerCount'>> = {
  codex: { title: 'Codex Forge Circle', glyph: 'HF', x: 23, y: 58 },
  claude: { title: 'Claude Archive Choir', glyph: 'SC', x: 68, y: 24 },
  openclaw: { title: 'OpenClaw Herald Gate', glyph: 'HG', x: 79, y: 66 },
  ollama: { title: 'Ollama Dragon Peak', glyph: 'DR', x: 45, y: 18 },
  browser: { title: 'Browser Ranger Watch', glyph: 'RG', x: 37, y: 76 },
  telegram: { title: 'Telegram Horn Tower', glyph: 'BN', x: 88, y: 42 },
  docker: { title: 'Docker Brass Docks', glyph: 'AN', x: 57, y: 82 },
  powershell: { title: 'PowerShell Rune Hall', glyph: 'PW', x: 15, y: 31 },
  node: { title: 'Node Clockwork Grove', glyph: 'ND', x: 55, y: 49 },
  'local-service': { title: 'Local Service Bastion', glyph: 'WD', x: 72, y: 51 },
  manual: { title: 'Manual Charter Camp', glyph: 'BN', x: 28, y: 20 },
  unknown: { title: 'Unknown Traveler Road', glyph: 'AG', x: 50, y: 62 }
};

function buildClusters(agents: RpgAgent[]): AgentCluster[] {
  const groups = new Map<string, RpgAgent[]>();
  agents.forEach((agent) => {
    const key = agent.type in clusterPositions ? agent.type : 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  });
  return Array.from(groups.entries())
    .map(([key, clusterAgents]) => ({
      key,
      ...clusterPositions[key],
      agents: clusterAgents,
      activeCount: clusterAgents.filter((agent) => agent.status === 'active').length,
      dangerCount: clusterAgents.filter((agent) => agent.status === 'blocked' || agent.status === 'failed').length
    }))
    .sort((left, right) => right.agents.length - left.agents.length);
}

function ClusterNode({ cluster, selected, onSelect }: { cluster: AgentCluster; selected: boolean; onSelect: (cluster: AgentCluster) => void }) {
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
        <p>Choose a running agent to inspect status reasoning, redacted transcript excerpts, logs, and local artifacts.</p>
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
      {agent.signal.source === 'codex-session-adapter' && (
        <div className="control-warning">
          Remote control is intentionally read-only here. This public site can view redacted local Codex transcripts through your bridge, but it does not execute commands on your PC.
        </div>
      )}
      <p className="live-action"><strong>Live RPG action:</strong> {agent.liveAction}</p>
      <div className="replay-stats">
        <span><strong>{agent.signal.conversationSnippets.length}</strong> transcript lines</span>
        <span><strong>{agent.signal.reasons.length}</strong> classification signals</span>
        <span><strong>{agent.signal.artifacts.length}</strong> local artifacts</span>
      </div>
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
        <h3>Live Conversation / Progress Feed</h3>
        <div className="conversation-box">
          {agent.signal.conversationSnippets.length
            ? agent.signal.conversationSnippets.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)
            : <code>No readable local transcript source was found for this running agent. The observer will not invent conversation text.</code>}
        </div>
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
        <p className="eyebrow">Codex Sessions</p>
        <h2>{agents.length} live</h2>
      </div>
      <label className="search-field">
        Find agent
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="session name, prompt, file..." />
      </label>
      <label className="search-field">
        Status
        <select value={filter} onChange={(event) => onFilter(event.target.value as AgentStatus | 'all')}>
          <option value="all">All live Codex sessions</option>
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
              <em>{agent.className} - {agent.signal.processName ?? agent.type}</em>
              <small>{agent.liveAction}</small>
            </span>
            <i>{agent.status}</i>
          </button>
        ))}
        {!agents.length && (
          <div className="no-menu-results">
            <strong>No Codex sessions match this view.</strong>
            <p>Clear filters or start/use a Codex session; the menu is intentionally session-first, not process-first.</p>
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

function SessionTimeline({ events, selectedId }: { events: RealmEvent[]; selectedId?: string }) {
  const selectedEvents = events.filter((event) => !selectedId || event.agentId === selectedId).slice(0, 8);
  return (
    <section className="session-timeline" aria-label="Selected agent live timeline">
      <div>
        <p className="eyebrow">Live Replay Trail</p>
        <h2>Signals, events, and transcript echoes</h2>
      </div>
      <div className="timeline-rail">
        {selectedEvents.map((event) => (
          <article key={event.id} className={event.severity}>
            <time>{new Date(event.atIso).toLocaleTimeString()}</time>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
          </article>
        ))}
        {!selectedEvents.length && <article><strong>No selected-agent events yet.</strong><p>The stream is waiting for fresh local signals.</p></article>}
      </div>
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
  const [streamMode, setStreamMode] = useState<'connecting' | 'streaming' | 'polling' | 'paused'>('connecting');
  const isLocalObserverHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  const applyLiveSnapshot = useCallback((liveSnapshot: RealmSnapshot, mode: string) => {
    setConnectionMode(mode);
    setSnapshot(liveSnapshot);
    setSelectedId((current) => liveSnapshot.agents.some((agent) => agent.id === current) ? current : liveSnapshot.agents[0]?.id);
    setError(undefined);
  }, []);

  const readLiveObserverUrl = useCallback(async (): Promise<string | undefined> => {
    if (isLocalObserverHost) return '';
    const configResponse = await fetch(`/live-observer.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!configResponse.ok) return undefined;
    const config = await configResponse.json() as LiveObserverConfig;
    return config.enabled && config.observerUrl ? config.observerUrl.replace(/\/$/, '') : undefined;
  }, [isLocalObserverHost]);

  const refresh = useCallback(async () => {
    if (paused || streamMode === 'streaming') return;
    try {
      const observerUrl = await readLiveObserverUrl();
      if (observerUrl === undefined) {
        setConnectionMode('static preview: no live observer URL configured');
        setSnapshot(staticPreviewSnapshot());
        setError('No live Windows observer is configured for this deployment.');
        return;
      }
      const endpoint = observerUrl ? `${observerUrl}/api/realm` : '/api/realm';
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`observer returned ${response.status}`);
      const data = await response.json() as RealmSnapshot;
      applyLiveSnapshot(data, observerUrl ? `live polling via ${observerUrl}` : 'live local polling');
      setStreamMode((current) => current === 'streaming' ? current : 'polling');
    } catch (refreshError) {
      setStreamMode('polling');
      setError(refreshError instanceof Error ? refreshError.message : 'unknown observer failure');
      setSnapshot((current) => current ?? staticPreviewSnapshot());
    }
  }, [applyLiveSnapshot, paused, readLiveObserverUrl, streamMode]);

  useEffect(() => {
    if (paused || typeof EventSource === 'undefined') {
      return undefined;
    }

    let eventSource: EventSource | undefined;
    let cancelled = false;

    const openStream = async () => {
      try {
        const observerUrl = await readLiveObserverUrl();
        if (observerUrl === undefined || cancelled) {
          setStreamMode('polling');
          return;
        }
        eventSource = new EventSource(`${observerUrl}/api/realm/stream`);
        eventSource.addEventListener('open', () => setStreamMode('streaming'));
        eventSource.addEventListener('realm', (event) => {
          const nextSnapshot = JSON.parse((event as MessageEvent<string>).data) as RealmSnapshot;
          applyLiveSnapshot(nextSnapshot, observerUrl ? `live SSE stream via ${observerUrl}` : 'live local SSE stream');
          setStreamMode('streaming');
        });
        eventSource.addEventListener('observer-error', (event) => {
          const detail = JSON.parse((event as MessageEvent<string>).data) as { detail?: string };
          setError(detail.detail ?? 'observer stream error');
        });
        eventSource.addEventListener('error', () => setStreamMode('polling'));
      } catch (streamError) {
        setStreamMode('polling');
        setError(streamError instanceof Error ? streamError.message : 'stream unavailable');
      }
    };

    void openStream();
    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [applyLiveSnapshot, paused, readLiveObserverUrl]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), liveRefreshMs);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const menuAgents = useMemo(() => {
    const list = snapshot?.agents ?? [];
    const codexSessions = list.filter((agent) => agent.signal.source === 'codex-session-adapter');
    const sessionFirst = codexSessions.length ? codexSessions : list;
    const normalizedSearch = search.trim().toLowerCase();
    return sessionFirst.filter((agent) => {
      const matchesStatus = filter === 'all' || agent.status === filter;
      const haystack = `${agent.name} ${agent.type} ${agent.className} ${agent.liveAction} ${agent.signal.processName ?? ''} ${agent.signal.conversationSnippets.join(' ')}`.toLowerCase();
      return matchesStatus && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
  }, [snapshot, filter, search]);

  const clusters = useMemo(() => buildClusters(menuAgents), [menuAgents]);
  const selected = menuAgents.find((agent) => agent.id === selectedId) ?? menuAgents[0];
  const visibleStreamMode = paused ? 'paused' : streamMode;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Local AI Workforce RPG</p>
          <h1>Agent Realms</h1>
          <p className="lede">A living fantasy kingdom mapped from this Windows PC's local agent processes, folders, logs, transcripts, and loopback services.</p>
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
          <strong>{menuAgents.length}</strong>
          <span>Codex sessions in menu - {visibleStreamMode === 'streaming' ? `SSE stream every ${streamRefreshMs / 1000}s` : `${visibleStreamMode} polling every ${liveRefreshMs / 1000}s`} - last pulse {formatFreshness(snapshot?.generatedAtIso)}</span>
        </div>
        <strong className="connection-mode">{connectionMode}</strong>
        <div className="discovery-notes">
          {(snapshot?.discoveryNotes ?? ['Loading discovery adapters...']).map((note) => <span key={note}>{note}</span>)}
        </div>
      </section>

      <section className="realm-layout">
        <AgentMenu agents={menuAgents} selectedId={selected?.id} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} onSelect={setSelectedId} />
        <div className="map-panel">
          <div className="map-header">
            <div>
              <p className="eyebrow">Moonlit Operations Map</p>
              <h2>{clusters.length ? `${clusters.length} ecosystems, ${menuAgents.length} Codex sessions` : 'No live Codex sessions yet'}</h2>
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
            {!menuAgents.length && <div className="guided-setup">Start or use Codex; this menu shows session transcripts first, not browser helper processes.</div>}
          </div>
          <div className="ecosystem-strip">
            {clusters.map((cluster) => (
              <button key={cluster.key} className={cluster.agents.some((agent) => agent.id === selected?.id) ? 'active' : ''} onClick={() => setSelectedId(cluster.agents[0]?.id)}>
                <span>{cluster.glyph}</span>
                <strong>{cluster.title}</strong>
                <em>{cluster.agents.length} running - {cluster.activeCount} active</em>
              </button>
            ))}
          </div>
        </div>
        <DetailPanel agent={selected} />
      </section>

      <SessionTimeline events={snapshot?.events ?? []} selectedId={selected?.id} />

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
