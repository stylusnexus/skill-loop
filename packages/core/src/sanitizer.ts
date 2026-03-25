import type { SkillRun, SanitizedSkillRun } from './types.js';

const REDACTED = '[redacted]';

/**
 * Core-level sanitizer that strips sensitive fields from a SkillRun
 * before it reaches any sync plugin.
 *
 * This runs in the core, not in the plugin — plugins cannot bypass it.
 * The only way to send sensitive fields is for the user to explicitly
 * set `sync.allowSensitiveFields: true` in their config.
 */
export function sanitizeRunForSync(run: SkillRun, allowSensitiveFields: boolean): SanitizedSkillRun {
  return {
    id: run.id,
    skillId: run.skillId,
    skillVersion: run.skillVersion,
    timestamp: run.timestamp,
    platform: run.platform,
    taskContext: allowSensitiveFields ? run.taskContext : REDACTED,
    taskTags: run.taskTags,
    outcome: run.outcome,
    errorType: run.errorType,
    errorDetail: allowSensitiveFields ? run.errorDetail : (run.errorDetail ? REDACTED : undefined),
    durationMs: run.durationMs,
    amendmentId: run.amendmentId,
  };
}
