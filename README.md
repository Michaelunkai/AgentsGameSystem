# Agent Realms

Agent Realms is a local-only RPG operations map for this Windows PC. It observes agent-like local processes, folders, logs, and loopback-only status endpoints, then renders them as fantasy RPG characters in connected ecosystems.

Normal operation consumes zero hosted model tokens. The app does not include OpenAI, Anthropic, Gemini, Groq, OpenRouter, hosted LangChain model clients, or browser-chat automation. The backend reads local process metadata, local folders, optional local logs, and localhost-only status endpoints. RPG classes, quests, events, and character state are deterministic templates.

## Run Locally

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Useful commands:

```powershell
npm run discover
npm run test
npm run lint
npm run build
npm run verify:token-free
```

## Configure Agents

Edit `agent-realms.config.json` to add manual sources. Supported fields include `name`, `type`, `processMatchers`, `paths`, `logPaths`, `statusEndpoint`, and parser patterns. Non-local status endpoints are disabled by default. A safe example is also available at `public/agent-realms.config.sample.json`.

## Token-Free Proof

The runtime proof is visible in the top ribbon. Code-level proof is enforced by `npm run verify:token-free`, which scans runtime files for hosted LLM provider URLs, SDK imports, and client markers. The only network feature allowed by default is localhost status observation.

## Global URL

Deployment target: Netlify. The permanent URL is added here after deployment verification.
