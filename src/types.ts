export type AgentStatus = 'active' | 'idle' | 'blocked' | 'failed' | 'completed' | 'waiting' | 'sleeping' | 'unknown';

export type AgentSourceType =
  | 'codex'
  | 'claude'
  | 'openclaw'
  | 'ollama'
  | 'browser'
  | 'telegram'
  | 'docker'
  | 'powershell'
  | 'node'
  | 'local-service'
  | 'manual'
  | 'unknown';

export interface AgentSignal {
  id: string;
  name: string;
  type: AgentSourceType;
  source: string;
  status: AgentStatus;
  confidence: number;
  pid?: number;
  processName?: string;
  path?: string;
  uptimeSeconds?: number;
  lastSeenIso: string;
  lastActivityIso?: string;
  ports: number[];
  logSnippets: string[];
  artifacts: string[];
  reasons: string[];
  relationships: string[];
}

export interface RpgAgent {
  id: string;
  name: string;
  type: AgentSourceType;
  status: AgentStatus;
  className: string;
  biome: string;
  portrait: string;
  aura: string;
  health: number;
  focus: number;
  resourceLabel: string;
  resourceValue: number;
  quest: string;
  animation: string;
  territory: {
    title: string;
    details: string[];
    x: number;
    y: number;
  };
  signal: AgentSignal;
}

export interface RealmEvent {
  id: string;
  atIso: string;
  agentId: string;
  title: string;
  detail: string;
  severity: 'info' | 'success' | 'warning' | 'danger';
}

export interface RealmSnapshot {
  generatedAtIso: string;
  tokenFree: {
    enabled: true;
    proof: string[];
    forbiddenProviders: string[];
    networkPolicy: string;
  };
  agents: RpgAgent[];
  events: RealmEvent[];
  discoveryNotes: string[];
}
