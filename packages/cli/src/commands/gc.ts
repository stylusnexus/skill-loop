import { gc, loadConfig } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function gcCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  console.log(`Pruning runs older than ${config.retention.maxRunAgeDays} days...\n`);

  const result = await gc(telemetryDir, config);

  console.log(`Runs before: ${result.runsBefore}`);
  console.log(`Runs after:  ${result.runsAfter}`);
  console.log(`Pruned:      ${result.pruned}`);

  if (result.oldestRetained) {
    console.log(`Oldest retained: ${result.oldestRetained}`);
  }

  if (result.pruned === 0) {
    console.log('\nNo runs to prune.');
  } else {
    console.log(`\nCleaned up ${result.pruned} old run(s). Index rebuilt.`);
  }
}
