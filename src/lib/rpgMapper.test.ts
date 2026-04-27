import { describe, expect, it } from 'vitest';
import type { AgentSignal } from '../types';
import { mapSignalToRpg } from './rpgMapper';

const baseSignal: AgentSignal = {
  id: 'process:codex:18712',
  name: 'Codex 18712',
  type: 'codex',
  source: 'process',
  status: 'active',
  confidence: 0.94,
  pid: 18712,
  processName: 'codex',
  lastSeenIso: '2026-04-27T19:00:00.000Z',
  ports: [],
  logSnippets: [],
  conversationSnippets: [],
  artifacts: ['C:\\Users\\micha\\.codex'],
  reasons: ['process matcher codex'],
  relationships: ['node'],
  liveAction: 'forging code and tool calls'
};

describe('mapSignalToRpg', () => {
  it('maps identical signals deterministically', () => {
    expect(mapSignalToRpg(baseSignal)).toEqual(mapSignalToRpg(baseSignal));
  });

  it('translates source type into a fantasy class and biome', () => {
    const rpg = mapSignalToRpg(baseSignal);
    expect(rpg.className).toBe('Rune Artificer');
    expect(rpg.biome).toBe('Ember Forge City');
    expect(rpg.quest).toContain('forging code and tool calls');
    expect(rpg.quest).toContain('process matcher codex');
  });
});
