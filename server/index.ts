import express from 'express';
import { buildRealmSnapshot } from './realm';

const app = express();
const port = Number(process.env.AGENT_REALMS_PORT ?? 4387);

app.use(express.json({ limit: '128kb' }));

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

app.get('/api/token-free', (_request, response) => {
  response.json({ ok: true, mode: 'token-free', policy: 'local observation only' });
});

app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Agent Realms observer listening on http://127.0.0.1:${port}\n`);
});
