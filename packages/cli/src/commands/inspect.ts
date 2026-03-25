import { loadConfig, readJson, Inspector } from '@stylusnexus/skill-loop';
import type { SkillRegistry } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function inspectCommand(projectRoot: string, args: string[]): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  // Parse --skill flag
  let skillName: string | undefined;
  const skillIdx = args.indexOf('--skill');
  if (skillIdx !== -1 && args[skillIdx + 1]) {
    skillName = args[skillIdx + 1];
  }

  console.log('Running inspection...\n');

  const inspector = new Inspector(projectRoot, telemetryDir, config);
  const result = await inspector.inspect(skillName);

  console.log(`Skills analyzed: ${result.skillCount}`);
  console.log(`Total runs in window: ${result.totalRuns}`);
  console.log('');

  if (result.patterns.length === 0) {
    console.log('No skills found to analyze.');
    return;
  }

  // Show patterns
  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skillMap = new Map(registry?.skills.map(s => [s.id, s.name]) ?? []);

  for (const pattern of result.patterns) {
    const name = skillMap.get(pattern.skillId) ?? pattern.skillId.slice(0, 8);
    const failPct = (pattern.failureRate * 100).toFixed(0);
    const stalePct = (pattern.stalenessScore * 100).toFixed(0);
    console.log(`  ${name}: ${pattern.totalRuns} runs, ${failPct}% failures, ${stalePct}% stale, trend: ${pattern.trend}`);
  }

  // Show flagged
  if (result.flagged.length > 0) {
    console.log(`\nFlagged skills (${result.flagged.length}):`);
    for (const flag of result.flagged) {
      const icon = flag.severity === 'high' ? '[HIGH]' : flag.severity === 'medium' ? '[MED]' : '[LOW]';
      console.log(`  ${icon} ${flag.skillName}:`);
      for (const reason of flag.reasons) {
        console.log(`    - ${reason}`);
      }
    }
  } else {
    console.log('\nNo issues found. All skills are healthy.');
  }

  console.log(`\nReport saved to ${config.telemetryDir}/reports/`);
}
