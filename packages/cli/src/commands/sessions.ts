import { loadConfig, readJson, listSessions } from '@stylusnexus/skill-loop';
import type { SkillRegistry } from '@stylusnexus/skill-loop';
import { join } from 'node:path';

export async function sessionsCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const sessions = await listSessions(telemetryDir);

  if (sessions.length === 0) {
    console.log('No active detection sessions.');
    return;
  }

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skillMap = new Map(registry?.skills.map(s => [s.id, s.name]) ?? []);

  console.log(`Active detection sessions: ${sessions.length}`);
  console.log('');
  for (const session of sessions) {
    const skillName = skillMap.get(session.skillId) ?? session.skillId.slice(0, 8);
    const age = Date.now() - new Date(session.lastActivityAt).getTime();
    const ageStr = age < 60_000
      ? `${Math.round(age / 1000)}s ago`
      : `${Math.round(age / 60_000)}m ago`;

    console.log(`  ${skillName}`);
    console.log(`    Method:     ${session.primaryMethod}`);
    console.log(`    Confidence: ${(session.compositeConfidence * 100).toFixed(0)}%`);
    console.log(`    Signals:    ${session.signals.length}`);
    console.log(`    Opened:     ${session.openedAt}`);
    console.log(`    Last seen:  ${ageStr}`);
    console.log('');
  }

  console.log(`Sessions expire after ${config.detection.sessionWindowMs / 1000}s of inactivity.`);
}
