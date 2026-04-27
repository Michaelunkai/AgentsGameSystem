import type { AgentSignal, RealmSnapshot } from '../types';
import { buildEvents } from './events';
import { mapSignalToRpg } from './rpgMapper';
import { tokenFreeProof, FORBIDDEN_PROVIDER_MARKERS } from './tokenFree';

const generatedAtIso = new Date('2026-04-27T00:00:00.000Z').toISOString();

const previewSignals: AgentSignal[] = [
  {
    id: 'preview:codex',
    name: 'Preview Codex Forge',
    type: 'codex',
    source: 'static-preview',
    status: 'unknown',
    confidence: 0.5,
    lastSeenIso: generatedAtIso,
    ports: [],
    logSnippets: [],
    artifacts: ['Run locally to observe C:\\Users\\[user]\\.codex'],
    reasons: ['global static preview cannot inspect private Windows processes'],
    relationships: []
  },
  {
    id: 'preview:openclaw',
    name: 'Preview OpenClaw Herald',
    type: 'openclaw',
    source: 'static-preview',
    status: 'sleeping',
    confidence: 0.5,
    lastSeenIso: generatedAtIso,
    ports: [],
    logSnippets: [],
    artifacts: ['Run npm run dev on this PC for live discovery'],
    reasons: ['local observer backend is not available on the public static URL'],
    relationships: []
  }
];

export function staticPreviewSnapshot(): RealmSnapshot {
  return {
    generatedAtIso,
    tokenFree: {
      enabled: true,
      proof: [...tokenFreeProof(), 'Public static preview performs no process scraping and no model calls.'],
      forbiddenProviders: FORBIDDEN_PROVIDER_MARKERS,
      networkPolicy: 'Hosted preview has no backend observer; local app uses loopback-only observation.'
    },
    agents: previewSignals.map(mapSignalToRpg),
    events: buildEvents(previewSignals, generatedAtIso),
    discoveryNotes: [
      'Static preview mode: global URL cannot access this PC by design.',
      'Run locally for live Windows agent discovery.'
    ]
  };
}
