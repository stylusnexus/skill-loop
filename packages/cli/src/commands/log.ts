import { TelemetryWriter, loadConfig, readJson } from '@stylusnexus/skill-loop';
import type { SkillRun, SkillRegistry, RunOutcome } from '@stylusnexus/skill-loop';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const VALID_OUTCOMES: RunOutcome[] = ['success', 'failure', 'partial', 'unknown'];

export async function logCommand(projectRoot: string, args: string[]): Promise<void> {
  const [skillName, outcome] = args;

  if (!skillName || !outcome) {
    console.error('Usage: skill-loop log <skill-name> <outcome>');
    console.error('Outcomes: success, failure, partial, unknown');
    process.exit(1);
  }

  if (!VALID_OUTCOMES.includes(outcome as RunOutcome)) {
    console.error(`Invalid outcome "${outcome}". Must be one of: ${VALID_OUTCOMES.join(', ')}`);
    process.exit(1);
  }

  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skill = registry?.skills.find(s => s.name === skillName);

  if (!skill) {
    console.error(`Skill "${skillName}" not found in registry. Run \`skill-loop init\` first.`);
    process.exit(1);
  }

  const run: SkillRun = {
    id: randomUUID(),
    skillId: skill.id,
    skillVersion: skill.version,
    timestamp: new Date().toISOString(),
    platform: 'cli',
    taskContext: 'manual log',
    taskTags: [],
    outcome: outcome as RunOutcome,
    durationMs: -1,
  };

  const writer = new TelemetryWriter(telemetryDir);
  await writer.logRun(run);
  console.log(`Logged ${outcome} run for "${skillName}" (${run.id.slice(0, 8)})`);
}
