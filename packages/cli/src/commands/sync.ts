import { SyncRunner, loadConfig } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function syncCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  if (config.sync.plugins.length === 0) {
    console.log('No sync plugins configured.');
    console.log('Add plugins to skill-loop.config.json under sync.plugins to enable external sync.');
    return;
  }

  console.log(`Flushing sync queue (${config.sync.plugins.length} plugin(s) configured)...\n`);

  const runner = new SyncRunner(telemetryDir, config);

  // Plugin loading would go here — for now, report that plugins need to be registered
  console.log('Plugin loading is not yet implemented.');
  console.log('Registered plugins will be loaded from sync.plugins config in a future update.');
  console.log('\nTo manually flush queued events, plugins must be registered programmatically via the SyncRunner API.');
}
