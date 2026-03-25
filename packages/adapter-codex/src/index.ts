/**
 * Codex adapter for skill-loop.
 *
 * OpenAI Codex agents use AGENTS.md for configuration. This adapter provides
 * a helper function that Codex agents can call to log skill execution outcomes.
 *
 * Usage in a Codex agent:
 *
 *   import { logSkillRun } from '@stylusnexus/skill-loop-codex';
 *
 *   // After a skill executes:
 *   await logSkillRun({
 *     skillName: 'my-skill',
 *     outcome: 'success',
 *     taskContext: 'refactor auth module',
 *   });
 */

import { TelemetryWriter, loadConfig, readJson } from '@stylusnexus/skill-loop';
import type { SkillRun, SkillRegistry, RunOutcome } from '@stylusnexus/skill-loop';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface LogSkillRunOptions {
  skillName: string;
  outcome: RunOutcome;
  taskContext?: string;
  taskTags?: string[];
  errorDetail?: string;
  durationMs?: number;
  projectRoot?: string;
}

/**
 * Log a skill run from a Codex agent.
 * Resolves the skill from the registry and appends to runs.jsonl.
 */
export async function logSkillRun(options: LogSkillRunOptions): Promise<string | null> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skill = registry?.skills.find(s => s.name === options.skillName);

  if (!skill) return null;

  const run: SkillRun = {
    id: randomUUID(),
    skillId: skill.id,
    skillVersion: skill.version,
    timestamp: new Date().toISOString(),
    platform: 'codex',
    taskContext: (options.taskContext ?? '').slice(0, 200),
    taskTags: options.taskTags ?? [],
    outcome: options.outcome,
    errorType: options.errorDetail ? 'runtime_error' : undefined,
    errorDetail: options.errorDetail?.slice(0, 500),
    durationMs: options.durationMs ?? -1,
  };

  const writer = new TelemetryWriter(telemetryDir);
  await writer.logRun(run);

  return run.id;
}
