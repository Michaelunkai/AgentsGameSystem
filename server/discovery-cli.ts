import { buildRealmSnapshot } from './realm';

const snapshot = await buildRealmSnapshot();
process.stdout.write(JSON.stringify({
  generatedAtIso: snapshot.generatedAtIso,
  agents: snapshot.agents.map((agent) => ({
    name: agent.name,
    type: agent.type,
    status: agent.status,
    className: agent.className,
    biome: agent.biome,
    reasons: agent.signal.reasons
  })),
  notes: snapshot.discoveryNotes
}, null, 2));
