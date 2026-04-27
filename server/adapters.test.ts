import { describe, expect, it } from 'vitest';
import { normalizeStatus } from './adapters';

describe('adapter status normalization', () => {
  it('prioritizes failure signals from logs', () => {
    expect(normalizeStatus(['fatal error while running'], true, true)).toBe('failed');
  });

  it('uses recent artifact activity when logs are quiet', () => {
    expect(normalizeStatus([], true, true)).toBe('active');
  });

  it('falls back to sleeping without any signal', () => {
    expect(normalizeStatus([], false, false)).toBe('sleeping');
  });
});
