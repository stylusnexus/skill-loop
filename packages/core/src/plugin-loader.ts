import type { SyncPlugin, SkillLoopConfig } from './types.js';
import { SyncRunner } from './sync.js';

export interface PluginLoadResult {
  loaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Load sync plugins from config and register them with a SyncRunner.
 *
 * Each plugin in config.sync.plugins should be an npm package name
 * that exports a SyncPlugin object as its default export.
 *
 * The loader validates each plugin has the required interface
 * (name, version, filter, emit) before registering it.
 */
export async function loadPlugins(
  runner: SyncRunner,
  config: SkillLoopConfig
): Promise<PluginLoadResult> {
  const loaded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const pluginName of config.sync.plugins) {
    try {
      const mod = await import(pluginName);
      const plugin: unknown = mod.default ?? mod;

      if (!isValidPlugin(plugin)) {
        failed.push({
          name: pluginName,
          error: 'Invalid plugin: must export { name: string, version: string, filter: function, emit: function }',
        });
        continue;
      }

      runner.addPlugin(plugin as SyncPlugin);
      loaded.push(pluginName);
    } catch (err: any) {
      failed.push({
        name: pluginName,
        error: err.message ?? 'Unknown error during import',
      });
    }
  }

  return { loaded, failed };
}

/**
 * Validate that an object conforms to the SyncPlugin interface.
 */
function isValidPlugin(obj: unknown): obj is SyncPlugin {
  if (typeof obj !== 'object' || obj === null) return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.name === 'string' &&
    typeof p.version === 'string' &&
    typeof p.filter === 'function' &&
    typeof p.emit === 'function'
  );
}
