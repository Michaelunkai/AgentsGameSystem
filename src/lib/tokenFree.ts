export const FORBIDDEN_PROVIDER_MARKERS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'openrouter.ai/api',
  '@openai/',
  '@anthropic-ai/',
  'langchain/chat_models',
  'ChatOpenAI',
  'Anthropic'
];

export function tokenFreeProof(): string[] {
  return [
    'Runtime adapters use local process, folder, log, and localhost-only status observation.',
    'No OpenAI, Anthropic, Gemini, Groq, OpenRouter, or hosted LangChain model clients are dependencies.',
    'HTTP status adapter rejects non-loopback hosts by default.',
    'Log snippets and paths are redacted before leaving the local backend.',
    'Deterministic templates create RPG names, quests, classes, and events without inference calls.'
  ];
}

export function isAllowedLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}
