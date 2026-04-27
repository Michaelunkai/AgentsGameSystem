import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentSignal, AgentSourceType, AgentStatus } from '../src/types';
import { redactPathForPublic, redactSecretText } from '../src/lib/redaction';
import type { ManualAgentConfig } from './config';

const execFileAsync = promisify(execFile);

interface ProcessRow {
  Id: number;
  ProcessName: string;
  Path?: string;
  StartTime?: string;
}

interface PortRow {
  LocalAddress: string;
  LocalPort: number;
  OwningProcess: number;
}

const matcherTypes: Array<{ pattern: RegExp; type: AgentSourceType; label: string }> = [
  { pattern: /codex/i, type: 'codex', label: 'Codex CLI process' },
  { pattern: /claude|cowork/i, type: 'claude', label: 'Claude helper process' },
  { pattern: /claw|openclaw|clawdbot/i, type: 'openclaw', label: 'OpenClaw bot process' },
  { pattern: /ollama/i, type: 'ollama', label: 'Ollama process' },
  { pattern: /chrome|msedge|playwright/i, type: 'browser', label: 'browser automation surface' },
  { pattern: /telegram/i, type: 'telegram', label: 'Telegram process' },
  { pattern: /docker/i, type: 'docker', label: 'Docker agent process' },
  { pattern: /powershell|pwsh|windowsterminal|openconsole/i, type: 'powershell', label: 'PowerShell terminal process' },
  { pattern: /node|tsx|vite/i, type: 'node', label: 'Node runtime process' }
];

function parseJsonArray<T>(text: string): T[] {
  const ansiPattern = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, 'g');
  const trimmed = text.replace(/^0\s*/m, '').replace(ansiPattern, '').trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  return JSON.parse(trimmed.slice(start, end + 1)) as T[];
}

function normalizeStatus(logs: string[], hasProcess: boolean, recentArtifact: boolean): AgentStatus {
  const haystack = logs.join('\n').toLowerCase();
  if (/(exception|traceback|fatal|failed|error)/.test(haystack)) return 'failed';
  if (/(blocked|access denied|permission denied)/.test(haystack)) return 'blocked';
  if (/(waiting|approve|input required|confirm)/.test(haystack)) return 'waiting';
  if (/(complete|completed|success|done)/.test(haystack)) return 'completed';
  if (recentArtifact) return 'active';
  if (hasProcess) return 'idle';
  return 'sleeping';
}

function describeLiveAction(type: AgentSourceType, processName: string, ports: number[]): string {
  if (ports.length) {
    return `serving local portal ${ports.join(', ')}`;
  }
  const normalized = processName.toLowerCase();
  if (type === 'codex') return 'forging code and tool calls';
  if (type === 'claude') return 'copying context runes through a helper service';
  if (type === 'openclaw') return 'dispatching bot gates and message routes';
  if (type === 'browser') return normalized.includes('chrome') ? 'scouting browser portals' : 'watching embedded web views';
  if (type === 'telegram') return 'carrying Telegram messages across the harbor';
  if (type === 'docker') return 'maintaining container machinery';
  if (type === 'powershell') return 'guarding a command shell ritual';
  if (type === 'node') return 'ticking through a JavaScript work loop';
  if (type === 'ollama') return 'warming local model embers';
  return 'traveling through an unknown local task';
}

function uptimeSeconds(start?: string): number | undefined {
  if (!start) return undefined;
  const ms = Date.now() - new Date(start).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : undefined;
}

async function readProcesses(): Promise<ProcessRow[]> {
  const command = 'Get-Process | Select-Object Id,ProcessName,Path,StartTime -ErrorAction SilentlyContinue | ConvertTo-Json -Depth 3';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 15000, windowsHide: true });
  return parseJsonArray<ProcessRow>(stdout);
}

async function readPorts(): Promise<PortRow[]> {
  const command = 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Depth 3';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 15000, windowsHide: true });
  return parseJsonArray<PortRow>(stdout);
}

async function readRecentLog(path: string): Promise<string[]> {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 2_000_000) return [];
  const raw = await readFile(path, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).slice(-6).map((line) => redactSecretText(line).slice(0, 240));
}

function artifactFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  return Date.now() - stat.mtimeMs < 1000 * 60 * 30;
}

export async function discoverProcessSignals(): Promise<{ signals: AgentSignal[]; notes: string[] }> {
  const now = new Date().toISOString();
  const [processes, ports] = await Promise.all([readProcesses(), readPorts()]);
  const signals = processes.flatMap((process) => {
    const sourceText = `${process.ProcessName} ${process.Path ?? ''}`;
    const match = matcherTypes.find((entry) => entry.pattern.test(sourceText));
    if (!match) return [];
    const processPorts = ports.filter((port) => port.OwningProcess === process.Id).map((port) => port.LocalPort);
    return [{
      id: `process:${match.type}:${process.Id}`,
      name: `${match.type === 'node' ? 'Node Worker' : match.label.replace(' process', '')} ${process.Id}`,
      type: match.type,
      source: 'process-adapter',
      status: processPorts.length ? 'active' : 'idle',
      confidence: 0.78,
      pid: process.Id,
      processName: process.ProcessName,
      path: redactPathForPublic(process.Path),
      uptimeSeconds: uptimeSeconds(process.StartTime),
      lastSeenIso: now,
      ports: processPorts,
      logSnippets: [],
      artifacts: process.Path ? [redactPathForPublic(process.Path) ?? process.ProcessName] : [],
      reasons: [`${match.label} matched ${process.ProcessName}`, processPorts.length ? `listening on ${processPorts.join(', ')}` : 'process alive without local port'],
      relationships: processPorts.length ? ['local-service'] : [],
      liveAction: describeLiveAction(match.type, process.ProcessName, processPorts)
    } satisfies AgentSignal];
  });
  return { signals, notes: [`Process adapter scanned ${processes.length} processes and matched ${signals.length} agent-like surfaces.`] };
}

export async function discoverFolderSignals(): Promise<{ signals: AgentSignal[]; notes: string[] }> {
  const folders: Array<{ path: string; name: string; type: AgentSourceType }> = [
    { path: 'C:\\Users\\micha\\.codex', name: 'Codex Memory Citadel', type: 'codex' },
    { path: 'C:\\Users\\micha\\.claude', name: 'Claude Archive Annex', type: 'claude' },
    { path: 'F:\\study\\AI_ML\\LocalAI\\ollama\\16vram\\A', name: 'Ollama GPU Mountain', type: 'ollama' },
    { path: 'F:\\study\\AI_ML\\AI_and_Machine_Learning\\Artificial_Intelligence\\openclaw', name: 'OpenClaw Gatehouse', type: 'openclaw' }
  ];
  const found = folders.filter((folder) => existsSync(folder.path)).length;
  return { signals: [], notes: [`Folder adapter checked ${folders.length} known local roots and found ${found}; folders are context only and are not shown unless backed by a running process.`] };
}

export async function discoverManualSignals(configs: ManualAgentConfig[]): Promise<{ signals: AgentSignal[]; notes: string[] }> {
  await Promise.all(configs.map(async (config) => {
    const snippets = (await Promise.all(config.logPaths.map(readRecentLog))).flat();
    const fresh = config.paths.some(artifactFresh) || config.logPaths.some(artifactFresh);
    normalizeStatus(snippets, false, fresh);
  }));
  return { signals: [], notes: [`Manual config adapter loaded ${configs.length} definitions; definitions are not shown as agents unless a matching process is running.`] };
}

export { normalizeStatus };
