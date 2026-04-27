import { describe, expect, it } from 'vitest';
import { getBearerToken, isControlTokenValid, validateCreateSessionBody, validateSendMessageBody } from './control';

describe('control auth validation', () => {
  it('accepts exact bearer tokens only', () => {
    expect(getBearerToken('Bearer local-secret')).toBe('local-secret');
    expect(isControlTokenValid('local-secret', 'local-secret')).toBe(true);
    expect(isControlTokenValid('wrong-secret', 'local-secret')).toBe(false);
    expect(isControlTokenValid(undefined, 'local-secret')).toBe(false);
  });
});

describe('control request validation', () => {
  it('accepts empty session creation and bounded initial prompts', () => {
    expect(validateCreateSessionBody({}).success).toBe(true);
    expect(validateCreateSessionBody({ prompt: 'Reply with proof.' }).success).toBe(true);
  });

  it('rejects blank or oversized control messages', () => {
    expect(validateSendMessageBody({ prompt: '   ' }).success).toBe(false);
    expect(validateSendMessageBody({ prompt: 'x'.repeat(8001) }).success).toBe(false);
  });
});
