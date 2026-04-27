import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
  CommandLine?: string;
  StartTime?: string;
}

interface PortRow {
  LocalAddress: string;
  LocalPort: number;
  OwningProcess: number;
}

interface CodexSessionIndexRow {
  id: string;
  thread_name?: string;
  updated_at?: string;
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
  const command = 'Get-CimInstance Win32_Process | Select-Object @{Name="Id";Expression={$_.ProcessId}},@{Name="ProcessName";Expression={$_.Name}},Path,CommandLine,CreationDate | ConvertTo-Json -Depth 3';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 15000, windowsHide: true });
  return parseJsonArray<ProcessRow & { CreationDate?: string }>(stdout).map((process) => ({
    Id: process.Id,
    ProcessName: process.ProcessName,
    Path: process.Path,
    CommandLine: process.CommandLine,
    StartTime: process.CreationDate
  }));
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

function readNewestFiles(root: string, maxFiles: number): string[] {
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; mtime: number; size: number }> = [];
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const stat = statSync(fullPath);
      if (stat.size > 0) files.push({ path: fullPath, mtime: stat.mtimeMs, size: stat.size });
    }
  };
  visit(root);
  return files.sort((left, right) => right.mtime - left.mtime).slice(0, maxFiles).map((file) => file.path);
}

function readNewestSessionFiles(root: string, maxFiles: number, activeWindowMs: number): string[] {
  if (!existsSync(root)) return [];
  const cutoff = Date.now() - activeWindowMs;
  const files: Array<{ path: string; mtime: number; size: number }> = [];
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const stat = statSync(fullPath);
      if (stat.size > 0 && stat.mtimeMs >= cutoff) files.push({ path: fullPath, mtime: stat.mtimeMs, size: stat.size });
    }
  };
  visit(root);
  return files.sort((left, right) => right.mtime - left.mtime).slice(0, maxFiles).map((file) => file.path);
}

function extractMessageText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const item = payload as { type?: string; role?: string; content?: Array<{ type?: string; text?: string }> };
  if (item.type !== 'message' || !item.role) return undefined;
  const text = item.content?.map((part) => part.text).filter(Boolean).join('\n').trim();
  if (!text) return undefined;
  return `${item.role}: ${redactSecretText(text).replace(/\s+/g, ' ').slice(0, 900)}`;
}

function extractEventText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const event = payload as { message?: string; msg?: string; text?: string };
  const text = event.message ?? event.msg ?? event.text;
  if (!text) return undefined;
  return `event: ${redactSecretText(text).replace(/\s+/g, ' ').slice(0, 500)}`;
}

async function readCodexConversationSnippets(): Promise<string[]> {
  const roots = [
    'C:\\Users\\micha\\.codex\\sessions',
    'C:\\Users\\micha\\.codex\\history.jsonl'
  ];
  const sessionFiles = readNewestFiles(roots[0], 3);
  const files = [...sessionFiles, roots[1]].filter((file) => existsSync(file));
  const snippets: string[] = [];
  for (const file of files) {
    const stat = statSync(file);
    const byteCount = Math.min(stat.size, 500_000);
    const buffer = Buffer.alloc(byteCount);
    const fd = openSync(file, 'r');
    readSync(fd, buffer, 0, byteCount, stat.size - byteCount);
    closeSync(fd);
    const raw = buffer.toString('utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-500);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; payload?: unknown; text?: string };
        const text = entry.type === 'response_item'
          ? extractMessageText(entry.payload)
          : entry.type === 'event_msg'
            ? extractEventText(entry.payload)
            : entry.text
              ? `history: ${redactSecretText(entry.text).replace(/\s+/g, ' ').slice(0, 500)}`
              : undefined;
        if (text) snippets.push(text);
      } catch {
        continue;
      }
    }
  }
  return Array.from(new Set(snippets)).slice(-24);
}

function tailFile(file: string, maxBytes: number): string[] {
  const stat = statSync(file);
  const byteCount = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(byteCount);
  const fd = openSync(file, 'r');
  readSync(fd, buffer, 0, byteCount, stat.size - byteCount);
  closeSync(fd);
  return buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
}

function sessionIdFromPath(file: string): string {
  const basename = path.basename(file, '.jsonl');
  const match = basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? basename;
}

function readCodexSessionIndex(): Map<string, CodexSessionIndexRow> {
  const indexPath = 'C:\\Users\\micha\\.codex\\session_index.jsonl';
  const rows = new Map<string, CodexSessionIndexRow>();
  if (!existsSync(indexPath)) return rows;
  for (const line of tailFile(indexPath, 1_000_000)) {
    try {
      const row = JSON.parse(line) as CodexSessionIndexRow;
      if (row.id) rows.set(row.id, row);
    } catch {
      continue;
    }
  }
  return rows;
}

function readCodexConversationSnippetsFromFile(file: string): string[] {
  const snippets: string[] = [];
  for (const line of tailFile(file, 800_000).slice(-900)) {
    try {
      const entry = JSON.parse(line) as { type?: string; payload?: unknown };
      const text = entry.type === 'response_item'
        ? extractMessageText(entry.payload)
        : entry.type === 'event_msg'
          ? extractEventText(entry.payload)
          : undefined;
      if (text) snippets.push(text);
    } catch {
      continue;
    }
  }
  return Array.from(new Set(snippets)).slice(-80);
}

export async function discoverCodexSessionSignals(): Promise<{ signals: AgentSignal[]; notes: string[] }> {
  const root = 'C:\\Users\\micha\\.codex\\sessions';
  const files = readNewestSessionFiles(root, 120, 1000 * 60 * 60 * 12);
  const index = readCodexSessionIndex();
  const now = new Date().toISOString();
  const signals = files.map((file) => {
    const stat = statSync(file);
    const id = sessionIdFromPath(file);
    const indexed = index.get(id);
    const updatedIso = indexed?.updated_at ?? new Date(stat.mtimeMs).toISOString();
    const ageMs = Date.now() - new Date(updatedIso).getTime();
    const snippets = readCodexConversationSnippetsFromFile(file);
    const threadName = indexed?.thread_name?.trim() || path.basename(file, '.jsonl').replace(/^rollout-[^-]+-/, 'Codex session ');
    const status: AgentStatus = ageMs < 1000 * 60 * 20 ? 'active' : ageMs < 1000 * 60 * 90 ? 'idle' : 'sleeping';
    return {
      id: `codex-session:${id}`,
      name: `Codex Session: ${redactSecretText(threadName).slice(0, 80)}`,
      type: 'codex',
      source: 'codex-session-adapter',
      status,
      confidence: snippets.length ? 0.96 : 0.74,
      processName: 'codex-session-jsonl',
      path: redactPathForPublic(file),
      lastSeenIso: now,
      lastActivityIso: updatedIso,
      ports: [],
      logSnippets: [],
      conversationSnippets: snippets,
      artifacts: [redactPathForPublic(file) ?? 'redacted codex session file'],
      reasons: [
        `Codex session transcript file modified ${new Date(stat.mtimeMs).toLocaleString()}`,
        snippets.length ? `${snippets.length} redacted transcript entries parsed` : 'session file has no readable message entries yet'
      ],
      relationships: ['codex'],
      liveAction: snippets.length ? 'revealing live Codex conversation scrolls' : 'waiting for Codex transcript entries'
    } satisfies AgentSignal;
  });
  return { signals, notes: [`Codex session adapter found ${signals.length} recently active Codex session transcripts under ${redactPathForPublic(root)}.`] };
}

export async function discoverProcessSignals(): Promise<{ signals: AgentSignal[]; notes: string[] }> {
  const now = new Date().toISOString();
  const [processes, ports, codexConversationSnippets] = await Promise.all([readProcesses(), readPorts(), readCodexConversationSnippets()]);
  const signals = processes.flatMap((process) => {
    const sourceText = `${process.ProcessName} ${process.Path ?? ''} ${process.CommandLine ?? ''}`;
    const match = matcherTypes.find((entry) => entry.pattern.test(sourceText));
    if (!match) return [];
    const processPorts = ports.filter((port) => port.OwningProcess === process.Id).map((port) => port.LocalPort);
    const redactedCommandLine = redactPathForPublic(process.CommandLine);
    const redactedPath = redactPathForPublic(process.Path);
    return [{
      id: `process:${match.type}:${process.Id}`,
      name: `${match.type === 'node' ? 'Node Worker' : match.label.replace(' process', '')} ${process.Id}`,
      type: match.type,
      source: 'process-adapter',
      status: processPorts.length ? 'active' : 'idle',
      confidence: 0.78,
      pid: process.Id,
      processName: process.ProcessName,
      path: redactedPath,
      uptimeSeconds: uptimeSeconds(process.StartTime),
      lastSeenIso: now,
      ports: processPorts,
      logSnippets: [],
      conversationSnippets: match.type === 'codex' ? codexConversationSnippets : [],
      artifacts: [redactedPath, redactedCommandLine].filter(Boolean) as string[],
      reasons: [`${match.label} matched ${process.ProcessName}${process.CommandLine ? ' command line' : ''}`, processPorts.length ? `listening on ${processPorts.join(', ')}` : 'process alive without local port'],
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
