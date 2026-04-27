import { describe, expect, it } from 'vitest';
import { redactPathForPublic, redactSecretText } from './redaction';

describe('redaction', () => {
  it('redacts common token and key patterns', () => {
    const text = 'Bearer abcdefghijklmnop token=super-secret-value sk-abc123456789000000';
    const output = redactSecretText(text);
    expect(output).not.toContain('abcdefghijklmnop');
    expect(output).not.toContain('super-secret-value');
    expect(output).not.toContain('sk-abc');
  });

  it('hides user profile names in paths', () => {
    expect(redactPathForPublic('C:\\Users\\micha\\.codex\\logs')).toBe('C:\\Users\\[user]\\.codex\\logs');
  });
});
