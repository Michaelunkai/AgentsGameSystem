import type { AgentSignal, AgentSourceType, RpgAgent } from '../types';

const typeMap: Record<AgentSourceType, { className: string; biome: string; portrait: string; resource: string }> = {
  codex: { className: 'Rune Artificer', biome: 'Ember Forge City', portrait: 'hammer', resource: 'Build Heat' },
  claude: { className: 'Moon Scribe', biome: 'Silver Archive', portrait: 'scroll', resource: 'Context Ink' },
  openclaw: { className: 'Gate Herald', biome: 'Signal Bastion', portrait: 'horn', resource: 'Dispatch Bells' },
  ollama: { className: 'Crystal Dragon', biome: 'GPU Mountain', portrait: 'dragon', resource: 'VRAM Flame' },
  browser: { className: 'Portal Ranger', biome: 'Glasswood Crossing', portrait: 'compass', resource: 'Scout Marks' },
  telegram: { className: 'Courier Bard', biome: 'Message Harbor', portrait: 'lyre', resource: 'Message Wind' },
  docker: { className: 'Container Dwarf', biome: 'Iron Dockyard', portrait: 'anvil', resource: 'Crate Pressure' },
  powershell: { className: 'Shell Wizard', biome: 'Azure Runeway', portrait: 'wand', resource: 'Glyph Charge' },
  node: { className: 'Clockwork Tinker', biome: 'Brass Observatory', portrait: 'gear', resource: 'Event Ticks' },
  'local-service': { className: 'Ward Paladin', biome: 'Checkpoint Keep', portrait: 'shield', resource: 'Ward Light' },
  manual: { className: 'Named Adventurer', biome: 'Chartered Grove', portrait: 'banner', resource: 'Oath Strength' },
  unknown: { className: 'Unknown Traveler', biome: 'Fogbound Road', portrait: 'lantern', resource: 'Signal Echo' }
};

const statusAura = {
  active: 'ember',
  idle: 'brass',
  blocked: 'amber',
  failed: 'crimson',
  completed: 'emerald',
  waiting: 'moon',
  sleeping: 'smoke',
  unknown: 'fog'
};

const statusAnimation = {
  active: 'forging',
  idle: 'breathing',
  blocked: 'warding',
  failed: 'sparking',
  completed: 'celebrating',
  waiting: 'listening',
  sleeping: 'dreaming',
  unknown: 'scouting'
};

export function stableHash(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mapSignalToRpg(signal: AgentSignal): RpgAgent {
  const base = typeMap[signal.type] ?? typeMap.unknown;
  const seed = stableHash(`${signal.id}:${signal.type}:${signal.source}`);
  const healthBase = signal.status === 'failed' ? 28 : signal.status === 'blocked' ? 48 : signal.status === 'sleeping' ? 62 : 84;
  const activityBoost = signal.lastActivityIso ? 9 : 0;
  const health = Math.max(8, Math.min(100, healthBase + activityBoost - signal.logSnippets.length * 2));
  const focus = Math.max(12, Math.min(100, Math.round(signal.confidence * 100)));
  const resourceValue = Math.max(5, Math.min(100, 35 + signal.ports.length * 13 + signal.artifacts.length * 7 + (seed % 21)));
  const x = 10 + (seed % 78);
  const y = 14 + ((seed >>> 8) % 70);
  const signalPhrase = signal.reasons[0] ?? 'local observation';
  const quest = `${signal.name} patrols ${base.biome} after ${signalPhrase}.`;

  return {
    id: signal.id,
    name: signal.name,
    type: signal.type,
    status: signal.status,
    className: base.className,
    biome: base.biome,
    portrait: base.portrait,
    aura: statusAura[signal.status],
    health,
    focus,
    resourceLabel: base.resource,
    resourceValue,
    quest,
    animation: statusAnimation[signal.status],
    territory: {
      title: `${base.biome} Ecosystem`,
      details: [
        `${base.className} watch post`,
        signal.ports.length ? `Local ports: ${signal.ports.join(', ')}` : 'No local port binding observed',
        signal.artifacts.length ? `${signal.artifacts.length} watched artifact paths` : 'Process-only observation'
      ],
      x,
      y
    },
    signal
  };
}
