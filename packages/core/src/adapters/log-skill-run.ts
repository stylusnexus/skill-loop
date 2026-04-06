import { TelemetryWriter } from '../telemetry.js';
import { loadConfig } from '../config.js';
import { readJson } from '../storage.js';
import type { SkillRun, SkillRegistry, RunOutcome, Platform } from '../types.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface LogSkillRunOptions {
  skillName: string;
  platform: Platform;
  outcome: RunOutcome;
  taskContext?: string;
  taskTags?: string[];
  errorDetail?: string;
  durationMs?: number;
  projectRoot?: string;
}

/**
 * Log a skill run from any platform adapter.
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
    platform: options.platform,
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
