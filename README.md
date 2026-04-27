# Agent Realms

Agent Realms is a local-only RPG operations map for this Windows PC. It observes agent-like local processes, folders, logs, and loopback-only status endpoints, then renders currently running agents as fantasy RPG characters in connected ecosystems.

The live UI is built around a Moonlit Operations Map: the left rail lists every currently running detected agent/session, the central map groups them into decluttered RPG ecosystems, and the detail panel updates with that agent's live status, process evidence, progress-like RPG action, uptime, ports, redacted local conversation excerpts when available, redacted log snippets, and classification reasons.

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

Permanent URL: https://agentsgamesystem.netlify.app

The global URL can show this PC's real running agents only while the local observer and HTTPS tunnel are running. A public static site cannot inspect private Windows processes by itself, and website-only code cannot survive a Windows reboot with live PC access unless the observer/tunnel are started again by the user or by an OS startup service. This project does not add startup entries automatically.

## Live Global Bridge

The Netlify site can show real Windows agents only when this PC exposes the local observer through an HTTPS tunnel. Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-live-bridge.ps1
npm run build
npx netlify deploy --dir=dist --prod --site 5fb206e9-9b74-45e1-9027-10a03d31f7ae
```

This updates `public/live-observer.json` with the tunnel URL. A Cloudflare quick tunnel is not permanent; if it restarts, rerun the script and redeploy. A true always-on URL requires a named Cloudflare tunnel credential/service on this PC.
