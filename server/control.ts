import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import express from 'express';
import { z } from 'zod';
import { redactSecretText } from '../src/lib/redaction';

export type ControlStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ControlSessionSummary {
  id: string;
  title: string;
  mode: 'codex-exec-one-shot';
  status: ControlStatus;
  createdAtIso: string;
  updatedAtIso: string;
}

interface ControlEvent {
  id: number;
  atIso: string;
  type: 'status' | 'stdout' | 'stderr' | 'agent_message' | 'error';
  text: string;
}

interface ControlSession extends ControlSessionSummary {
  events: ControlEvent[];
  runningProcessId?: number;
}

const createSessionSchema = z.object({
  prompt: z.string().trim().min(1).max(8000).optional()
});

const sendMessageSchema = z.object({
  prompt: z.string().trim().min(1).max(8000)
});

export function validateCreateSessionBody(input: unknown) {
  return createSessionSchema.safeParse(input);
}

export function validateSendMessageBody(input: unknown) {
  return sendMessageSchema.safeParse(input);
}

export function getBearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function isControlTokenValid(provided: string | undefined, expected: string): boolean {
  return typeof provided === 'string' && provided.length > 0 && provided === expected;
}

function ensureControlToken(liveDir: string): { token: string; tokenFile: string; source: 'env' | 'file' | 'generated' } {
  const tokenFile = path.join(liveDir, 'control-token.txt');
  const envToken = process.env.AGENT_REALMS_CONTROL_TOKEN?.trim();
  if (envToken) return { token: envToken, tokenFile, source: 'env' };
  if (existsSync(tokenFile)) {
    const fileToken = readFileSync(tokenFile, 'utf8').trim();
    if (fileToken) return { token: fileToken, tokenFile, source: 'file' };
  }
  const token = randomBytes(24).toString('base64url');
  writeFileSync(tokenFile, `${token}\n`, { encoding: 'utf8', flag: 'w' });
  return { token, tokenFile, source: 'generated' };
}

function sseWrite(response: express.Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export class ControlManager {
  readonly token: string;
  readonly tokenFile: string;
  readonly tokenSource: 'env' | 'file' | 'generated';
  private readonly projectRoot: string;
  private readonly liveDir: string;
  private readonly sessions = new Map<string, ControlSession>();
  private readonly emitter = new EventEmitter();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.liveDir = path.join(projectRoot, '.agent-realms-live');
    mkdirSync(this.liveDir, { recursive: true });
    const tokenState = ensureControlToken(this.liveDir);
    this.token = tokenState.token;
    this.tokenFile = tokenState.tokenFile;
    this.tokenSource = tokenState.source;
  }

  status(authenticated: boolean) {
    return {
      enabled: true,
      authenticated,
      mode: 'codex-exec-one-shot',
      activeSessions: authenticated ? this.summaries() : [],
      tokenRequired: true,
      warning: 'Passive viewing is token-free. Sending messages invokes local Codex and may consume Codex/model tokens.'
    };
  }

  summaries(): ControlSessionSummary[] {
    return [...this.sessions.values()]
      .map((session) => this.toSummary(session))
      .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso));
  }

  createSession(prompt?: string): ControlSessionSummary {
    const now = new Date().toISOString();
    const session: ControlSession = {
      id: randomUUID(),
      title: prompt ? prompt.slice(0, 72) : 'Dashboard Codex session',
      mode: 'codex-exec-one-shot',
      status: 'queued',
      createdAtIso: now,
      updatedAtIso: now,
      events: []
    };
    this.sessions.set(session.id, session);
    this.persistSession(session);
    this.push(session, 'status', 'Dashboard-controlled Codex session created.');
    if (prompt) this.runPrompt(session.id, prompt);
    return this.toSummary(session);
  }

  sendMessage(sessionId: string, prompt: string): ControlSessionSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === 'running') {
      this.push(session, 'error', 'This dashboard session already has a Codex run in progress.');
      return this.toSummary(session);
    }
    this.runPrompt(sessionId, prompt);
    return this.toSummary(session);
  }

  getPublicSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session ? this.publicSession(session) : undefined;
  }

  stream(sessionId: string, response: express.Response) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      response.status(404).json({ error: 'control-session-not-found' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    sseWrite(response, 'control-session', this.publicSession(session));
    const listener = (changed: ControlSession) => {
      if (changed.id === sessionId) sseWrite(response, 'control-session', this.publicSession(changed));
    };
    this.emitter.on('session', listener);
    response.on('close', () => this.emitter.off('session', listener));
  }

  private runPrompt(sessionId: string, prompt: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const sandbox = process.env.AGENT_REALMS_CODEX_SANDBOX?.trim() || 'workspace-write';
    const launch = resolveCodexLaunch(this.projectRoot, sandbox);
    session.status = 'running';
    session.updatedAtIso = new Date().toISOString();
    this.push(session, 'status', `Starting local Codex via fixed command: ${launch.display}`);

    let child;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: this.projectRoot,
        windowsHide: true,
        shell: false,
        env: { ...process.env }
      });
    } catch (error) {
      session.status = 'failed';
      this.push(session, 'error', `Codex process failed to start: ${error instanceof Error ? error.message : 'unknown spawn failure'}`);
      return;
    }
    session.runningProcessId = child.pid;
    child.stdin.end(prompt);
    this.emit(session);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.captureOutput(session, 'stdout', chunk));
    child.stderr.on('data', (chunk: string) => this.captureOutput(session, 'stderr', chunk));
    child.on('error', (error) => {
      session.status = 'failed';
      this.push(session, 'error', `Codex process failed to start: ${error.message}`);
    });
    child.on('close', (code) => {
      session.status = code === 0 ? 'completed' : 'failed';
      session.runningProcessId = undefined;
      this.push(session, 'status', `Codex process exited with code ${code ?? 'unknown'}.`);
    });
  }

  private captureOutput(session: ControlSession, type: 'stdout' | 'stderr', chunk: string) {
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parsed = this.tryParseCodexJson(line);
      if (parsed) {
        this.push(session, parsed.type, parsed.text);
      } else {
        this.push(session, type, line);
      }
    }
  }

  private tryParseCodexJson(line: string): { type: ControlEvent['type']; text: string } | undefined {
    try {
      const entry = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } };
      if (entry.type === 'thread.started') return { type: 'status', text: `Codex thread started: ${entry.thread_id ?? 'unknown'}` };
      if (entry.type === 'turn.started') return { type: 'status', text: 'Codex turn started.' };
      if (entry.type === 'turn.completed') return { type: 'status', text: 'Codex turn completed.' };
      if (entry.type === 'item.completed' && entry.item?.type === 'agent_message' && entry.item.text) {
        return { type: 'agent_message', text: entry.item.text };
      }
      return { type: 'stdout', text: line };
    } catch {
      return undefined;
    }
  }

  private push(session: ControlSession, type: ControlEvent['type'], text: string) {
    session.updatedAtIso = new Date().toISOString();
    session.events.push({
      id: session.events.length + 1,
      atIso: session.updatedAtIso,
      type,
      text: redactSecretText(text).replaceAll(this.token, '[redacted-control-token]').slice(0, 4000)
    });
    this.persistSession(session);
    this.emit(session);
  }

  private emit(session: ControlSession) {
    this.emitter.emit('session', session);
  }

  private persistSession(session: ControlSession) {
    const statePath = path.join(this.liveDir, 'control-sessions.json');
    const logPath = path.join(this.liveDir, `control-session-${session.id}.log`);
    writeFileSync(statePath, JSON.stringify(this.summaries(), null, 2), 'utf8');
    writeFileSync(logPath, session.events.map((event) => `[${event.atIso}] ${event.type}: ${event.text}`).join('\n'), 'utf8');
  }

  private toSummary(session: ControlSession): ControlSessionSummary {
    return {
      id: session.id,
      title: session.title,
      mode: session.mode,
      status: session.status,
      createdAtIso: session.createdAtIso,
      updatedAtIso: session.updatedAtIso
    };
  }

  private publicSession(session: ControlSession) {
    return {
      ...this.toSummary(session),
      events: session.events
    };
  }
}

function resolveCodexLaunch(projectRoot: string, sandbox: string): { command: string; args: string[]; display: string } {
  const configured = process.env.AGENT_REALMS_CODEX_COMMAND?.trim();
  if (configured) {
    return {
      command: configured,
      args: ['exec', '--json', '-C', projectRoot, '--sandbox', sandbox, '-'],
      display: `${configured} exec --json -C <project> --sandbox ${sandbox} -`
    };
  }

  const userProfile = process.env.USERPROFILE || os.homedir();
  const localAppData = process.env.LOCALAPPDATA;
  const resolvedLocalAppData = localAppData || (userProfile ? path.join(userProfile, 'AppData', 'Local') : undefined);
  const appData = process.env.APPDATA;
  const resolvedAppData = appData || (userProfile ? path.join(userProfile, 'AppData', 'Roaming') : undefined);
  const directCandidates = [
    resolvedLocalAppData ? path.join(resolvedLocalAppData, 'Microsoft', 'WinGet', 'Packages', 'OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe', 'codex-x86_64-pc-windows-msvc.exe') : undefined,
    resolvedAppData ? path.join(resolvedAppData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe') : undefined,
    resolvedLocalAppData ? path.join(resolvedLocalAppData, 'Microsoft', 'WinGet', 'Links', 'codex.exe') : undefined
  ].filter(Boolean) as string[];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      return {
        command: candidate,
        args: ['exec', '--json', '-C', projectRoot, '--sandbox', sandbox, '-'],
        display: `${candidate} exec --json -C <project> --sandbox ${sandbox} -`
      };
    }
  }

  const packagesRoot = resolvedLocalAppData ? path.join(resolvedLocalAppData, 'Microsoft', 'WinGet', 'Packages') : undefined;
  if (packagesRoot && existsSync(packagesRoot)) {
    for (const folder of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!folder.isDirectory() || !folder.name.startsWith('OpenAI.Codex_')) continue;
      const candidate = path.join(packagesRoot, folder.name, 'codex-x86_64-pc-windows-msvc.exe');
      if (existsSync(candidate)) {
        return {
          command: candidate,
          args: ['exec', '--json', '-C', projectRoot, '--sandbox', sandbox, '-'],
          display: `${candidate} exec --json -C <project> --sandbox ${sandbox} -`
        };
      }
    }
  }

  const launcher = path.join(projectRoot, 'scripts', 'run-codex-control.ps1');
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-ProjectRoot', projectRoot, '-Sandbox', sandbox],
    display: `powershell.exe -File scripts/run-codex-control.ps1 -ProjectRoot <project> -Sandbox ${sandbox}`
  };
}

export function requireControlAuth(request: express.Request, response: express.Response, manager: ControlManager): boolean {
  const token = getBearerToken(request.headers.authorization) ?? request.headers['x-agent-realms-control-token']?.toString();
  if (isControlTokenValid(token, manager.token)) return true;
  response.status(401).json({ error: 'control-token-required', detail: 'Enter the local control token printed by scripts/start-live-bridge.ps1.' });
  return false;
}
