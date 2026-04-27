import express from 'express';
import { buildRealmSnapshot } from './realm';
import { ControlManager, requireControlAuth, validateCreateSessionBody, validateSendMessageBody } from './control';

const app = express();
const port = Number(process.env.AGENT_REALMS_PORT ?? 4387);
const projectRoot = process.cwd();
const controlManager = new ControlManager(projectRoot);
const allowedOrigins = new Set([
  'https://agentsgamesystem.netlify.app',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
]);

app.use(express.json({ limit: '128kb' }));
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && (allowedOrigins.has(origin) || origin.endsWith('.trycloudflare.com'))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Agent-Realms-Control-Token');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/realm', async (_request, response) => {
  try {
    response.json(await buildRealmSnapshot());
  } catch (error) {
    response.status(500).json({
      error: 'local-discovery-failed',
      detail: error instanceof Error ? error.message : 'unknown discovery error'
    });
  }
});

app.get('/api/realm/stream', async (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  let closed = false;
  request.on('close', () => {
    closed = true;
  });

  const sendSnapshot = async () => {
    if (closed) return;
    try {
      const snapshot = await buildRealmSnapshot();
      response.write(`event: realm\n`);
      response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (error) {
      response.write(`event: observer-error\n`);
      response.write(`data: ${JSON.stringify({ detail: error instanceof Error ? error.message : 'unknown discovery error' })}\n\n`);
    }
  };

  await sendSnapshot();
  const timer = setInterval(() => void sendSnapshot(), 2500);
  request.on('close', () => {
    clearInterval(timer);
  });
});

app.get('/api/token-free', (_request, response) => {
  response.json({ ok: true, mode: 'token-free', policy: 'local observation only' });
});

app.get('/api/control/status', (request, response) => {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? request.headers['x-agent-realms-control-token']?.toString();
  response.json(controlManager.status(provided === controlManager.token));
});

app.post('/api/control/sessions', (request, response) => {
  if (!requireControlAuth(request, response, controlManager)) return;
  const parsed = validateCreateSessionBody(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'invalid-control-session-request', detail: parsed.error.issues.map((issue) => issue.message).join('; ') });
    return;
  }
  response.status(201).json(controlManager.createSession(parsed.data.prompt));
});

app.post('/api/control/sessions/:id/messages', (request, response) => {
  if (!requireControlAuth(request, response, controlManager)) return;
  const parsed = validateSendMessageBody(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'invalid-control-message-request', detail: parsed.error.issues.map((issue) => issue.message).join('; ') });
    return;
  }
  const session = controlManager.sendMessage(request.params.id, parsed.data.prompt);
  if (!session) {
    response.status(404).json({ error: 'control-session-not-found' });
    return;
  }
  response.json(session);
});

app.get('/api/control/sessions/:id', (request, response) => {
  if (!requireControlAuth(request, response, controlManager)) return;
  const session = controlManager.getPublicSession(request.params.id);
  if (!session) {
    response.status(404).json({ error: 'control-session-not-found' });
    return;
  }
  response.json(session);
});

app.get('/api/control/sessions/:id/stream', (request, response) => {
  if (!requireControlAuth(request, response, controlManager)) return;
  controlManager.stream(request.params.id, response);
});

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    observer: 'agent-realms-windows-observer',
    control: {
      enabled: true,
      mode: 'codex-exec-one-shot',
      tokenFile: controlManager.tokenFile,
      tokenSource: controlManager.tokenSource
    },
    generatedAtIso: new Date().toISOString()
  });
});

app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Agent Realms observer listening on http://127.0.0.1:${port}\n`);
});
