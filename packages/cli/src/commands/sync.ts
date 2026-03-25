import { SyncRunner, loadConfig, loadPlugins } from '@stylusnexus/skill-loop';
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

  const runner = new SyncRunner(telemetryDir, config);
  const loadResult = await loadPlugins(runner, config);

  if (loadResult.loaded.length > 0) {
    console.log(`Loaded ${loadResult.loaded.length} plugin(s): ${loadResult.loaded.join(', ')}`);
  }
  if (loadResult.failed.length > 0) {
    console.log(`Failed to load ${loadResult.failed.length} plugin(s):`);
    for (const f of loadResult.failed) {
      console.log(`  ${f.name}: ${f.error}`);
    }
  }

  if (runner.pluginCount === 0) {
    console.log('\nNo plugins loaded successfully. Nothing to sync.');
    return;
  }

  console.log('\nFlushing sync queue...');
  const flushResult = await runner.flush();

  console.log(`  Retried:  ${flushResult.retried}`);
  console.log(`  Expired:  ${flushResult.expired}`);
  console.log(`  Failed:   ${flushResult.failed}`);

  if (flushResult.retried === 0 && flushResult.expired === 0 && flushResult.failed === 0) {
    console.log('\nSync queue is empty. Nothing to flush.');
  } else {
    console.log('\nSync complete.');
  }
}
