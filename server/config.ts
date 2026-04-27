import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { isAllowedLocalUrl } from '../src/lib/tokenFree';

const manualAgentSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  type: z.string().default('manual'),
  processMatchers: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  logPaths: z.array(z.string()).default([]),
  statusEndpoint: z.string().optional(),
  classOverride: z.string().optional(),
  biomeOverride: z.string().optional(),
  parser: z.object({
    activePatterns: z.array(z.string()).default(['running', 'started', 'processing']),
    waitingPatterns: z.array(z.string()).default(['waiting', 'input required', 'approve']),
    blockedPatterns: z.array(z.string()).default(['blocked', 'permission', 'denied']),
    failedPatterns: z.array(z.string()).default(['error', 'failed', 'exception']),
    completedPatterns: z.array(z.string()).default(['complete', 'done', 'success'])
  }).default({
    activePatterns: ['running', 'started', 'processing'],
    waitingPatterns: ['waiting', 'input required', 'approve'],
    blockedPatterns: ['blocked', 'permission', 'denied'],
    failedPatterns: ['error', 'failed', 'exception'],
    completedPatterns: ['complete', 'done', 'success']
  })
});

const configSchema = z.object({
  agents: z.array(manualAgentSchema).default([])
});

export type ManualAgentConfig = z.infer<typeof manualAgentSchema>;

export async function loadManualConfig(path = 'agent-realms.config.json'): Promise<ManualAgentConfig[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  const parsed = configSchema.parse(JSON.parse(raw));
  return parsed.agents.map((agent) => {
    if (agent.statusEndpoint && !isAllowedLocalUrl(agent.statusEndpoint)) {
      return { ...agent, statusEndpoint: undefined };
    }
    return agent;
  });
}
