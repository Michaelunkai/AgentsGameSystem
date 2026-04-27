import type { AgentSignal, RealmEvent } from '../types';

export function buildEvents(signals: AgentSignal[], generatedAtIso: string): RealmEvent[] {
  return signals.slice(0, 24).map((signal, index) => {
    const severity = signal.status === 'failed' ? 'danger' : signal.status === 'blocked' || signal.status === 'waiting' ? 'warning' : signal.status === 'completed' ? 'success' : 'info';
    return {
      id: `${signal.id}:event:${index}`,
      atIso: signal.lastActivityIso ?? signal.lastSeenIso ?? generatedAtIso,
      agentId: signal.id,
      title: `${signal.name} became ${signal.status}`,
      detail: signal.reasons.slice(0, 2).join(' | ') || 'Observed by local adapters.',
      severity
    };
  });
}
