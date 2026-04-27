const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(api[_-]?key|token|secret|password|passwd|pwd|cookie)(\s*[:=]\s*)["']?[^"'\s;]{4,}/gi,
  /\b[A-Za-z0-9+/]{44,}={0,2}\b/g
];

export function redactSecretText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => {
    return text.replace(pattern, (match, key, separator) => {
      if (typeof key === 'string' && typeof separator === 'string') {
        return `${key}${separator}[REDACTED]`;
      }
      if (typeof key === 'string' && match.toLowerCase().startsWith(key.toLowerCase())) {
        return `${key}[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }, value);
}

export function redactPathForPublic(value?: string): string | undefined {
  if (!value) return value;
  const redacted = redactSecretText(value);
  return redacted.replace(/C:\\Users\\[^\\]+/gi, 'C:\\Users\\[user]');
}
