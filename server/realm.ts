import type { RealmSnapshot } from '../src/types';
import { buildEvents } from '../src/lib/events';
import { mapSignalToRpg } from '../src/lib/rpgMapper';
import { FORBIDDEN_PROVIDER_MARKERS, tokenFreeProof } from '../src/lib/tokenFree';
import { loadManualConfig } from './config';
import { discoverCodexSessionSignals, discoverFolderSignals, discoverManualSignals, discoverProcessSignals } from './adapters';

export async function buildRealmSnapshot(): Promise<RealmSnapshot> {
  const generatedAtIso = new Date().toISOString();
  const manual = await loadManualConfig();
  const discoveries = await Promise.all([
    discoverCodexSessionSignals(),
    discoverProcessSignals(),
    discoverFolderSignals(),
    discoverManualSignals(manual)
  ]);
  const signals = discoveries.flatMap((entry) => entry.signals);
  const notes = discoveries.flatMap((entry) => entry.notes);
  const unique = new Map(signals.map((signal) => [signal.id, signal]));

  return {
    generatedAtIso,
    tokenFree: {
      enabled: true,
      proof: tokenFreeProof(),
      forbiddenProviders: FORBIDDEN_PROVIDER_MARKERS,
      networkPolicy: 'Only loopback HTTP status endpoints are allowed by default; hosted model providers are not contacted.'
    },
    agents: [...unique.values()].map(mapSignalToRpg).sort((a, b) => a.name.localeCompare(b.name)),
    events: buildEvents([...unique.values()], generatedAtIso),
    discoveryNotes: notes
  };
}
