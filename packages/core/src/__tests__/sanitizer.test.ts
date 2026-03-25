import { describe, it, expect } from 'vitest';
import { sanitizeRunForSync } from '../sanitizer.js';
import type { SkillRun } from '../types.js';

const baseRun: SkillRun = {
  id: 'run-1',
  skillId: 'skill-1',
  skillVersion: 1,
  timestamp: '2026-03-24T12:00:00Z',
  platform: 'claude',
  taskContext: 'refactor the auth module to use JWT tokens',
  taskTags: ['refactor', 'auth'],
  outcome: 'failure',
  errorType: 'runtime_error',
  errorDetail: 'TypeError: Cannot read properties of undefined (reading "token")',
  durationMs: 1234,
};

describe('sanitizeRunForSync', () => {
  it('redacts taskContext and errorDetail by default', () => {
    const sanitized = sanitizeRunForSync(baseRun, false);

    expect(sanitized.taskContext).toBe('[redacted]');
    expect(sanitized.errorDetail).toBe('[redacted]');

    // Non-sensitive fields preserved
    expect(sanitized.id).toBe('run-1');
    expect(sanitized.skillId).toBe('skill-1');
    expect(sanitized.outcome).toBe('failure');
    expect(sanitized.errorType).toBe('runtime_error');
    expect(sanitized.durationMs).toBe(1234);
    expect(sanitized.taskTags).toEqual(['refactor', 'auth']);
  });

  it('preserves sensitive fields when explicitly allowed', () => {
    const sanitized = sanitizeRunForSync(baseRun, true);

    expect(sanitized.taskContext).toBe('refactor the auth module to use JWT tokens');
    expect(sanitized.errorDetail).toBe('TypeError: Cannot read properties of undefined (reading "token")');
  });

  it('handles missing errorDetail gracefully', () => {
    const run = { ...baseRun, errorDetail: undefined };
    const sanitized = sanitizeRunForSync(run, false);

    expect(sanitized.errorDetail).toBeUndefined();
  });

  it('preserves structural fields regardless of mode', () => {
    const sanitized = sanitizeRunForSync(baseRun, false);

    expect(sanitized.platform).toBe('claude');
    expect(sanitized.skillVersion).toBe(1);
    expect(sanitized.timestamp).toBe('2026-03-24T12:00:00Z');
    expect(sanitized.amendmentId).toBeUndefined();
  });
});
