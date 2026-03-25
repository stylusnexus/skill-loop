import { loadConfig, readJson, TelemetryWriter } from '@stylusnexus/skill-loop';
import type { SkillRegistry, RunsIndex } from '@stylusnexus/skill-loop';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function statusCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skillCount = registry?.skills.length ?? 0;

  const writer = new TelemetryWriter(telemetryDir);
  const runCount = await writer.getRunCount();
  const index = await writer.getIndex();

  const runsSize = await safeFileSize(join(telemetryDir, 'runs.jsonl'));
  const registrySize = await safeFileSize(join(telemetryDir, 'registry.json'));

  let successes = 0, failures = 0, partials = 0, unknowns = 0;
  if (index?.entries) {
    for (const entry of index.entries) {
      switch (entry.outcome) {
        case 'success': successes++; break;
        case 'failure': failures++; break;
        case 'partial': partials++; break;
        case 'unknown': unknowns++; break;
      }
    }
  }

  console.log('skill-loop status');
  console.log('=================');
  console.log(`Skills registered: ${skillCount}`);
  console.log(`Total runs logged: ${runCount}`);
  console.log(`  Success: ${successes}  Failure: ${failures}  Partial: ${partials}  Unknown: ${unknowns}`);
  console.log(`\nStorage:`);
  console.log(`  runs.jsonl:    ${formatSize(runsSize)}`);
  console.log(`  registry.json: ${formatSize(registrySize)}`);

  if (skillCount > 0 && runCount === 0) {
    console.log('\nNo runs logged yet. Skills will be tracked once a platform adapter is active.');
  }

  if (failures > 0 && runCount > 0) {
    const failRate = ((failures / runCount) * 100).toFixed(1);
    console.log(`\nOverall failure rate: ${failRate}%`);
  }
}

async function safeFileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '(empty)';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
