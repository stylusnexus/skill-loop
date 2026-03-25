import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPlugins } from '../plugin-loader.js';
import { SyncRunner } from '../sync.js';
import { DEFAULT_CONFIG } from '../config.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SkillLoopConfig } from '../types.js';

describe('Plugin Loader', () => {
  let dir: string;
  let config: SkillLoopConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-plugins-'));
    await mkdir(dir, { recursive: true });
    config = { ...DEFAULT_CONFIG };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('returns empty results when no plugins configured', async () => {
    const runner = new SyncRunner(dir, config);
    const result = await loadPlugins(runner, config);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(runner.pluginCount).toBe(0);
  });

  it('reports failed load for non-existent package', async () => {
    config.sync.plugins = ['@nonexistent/plugin-that-does-not-exist'];
    const runner = new SyncRunner(dir, config);
    const result = await loadPlugins(runner, config);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('@nonexistent/plugin-that-does-not-exist');
    expect(result.failed[0].error).toBeTruthy();
  });

  it('reports failed load for invalid plugin shape', async () => {
    // Create a local module that exports the wrong shape
    const pluginDir = join(dir, 'bad-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'bad-plugin', version: '1.0.0', type: 'module', main: 'index.js' }));
    await writeFile(join(pluginDir, 'index.js'), 'export default { notAPlugin: true };');

    config.sync.plugins = [pluginDir];
    const runner = new SyncRunner(dir, config);
    const result = await loadPlugins(runner, config);

    expect(result.loaded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain('Invalid plugin');
  });

  it('loads a valid plugin and registers it', async () => {
    // Create a local module that exports a valid plugin
    const pluginDir = join(dir, 'good-plugin');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'good-plugin', version: '1.0.0', type: 'module', main: 'index.js' }));
    await writeFile(join(pluginDir, 'index.js'), `
      export default {
        name: 'good-plugin',
        version: '1.0.0',
        filter: () => true,
        emit: async () => {},
      };
    `);

    config.sync.plugins = [pluginDir];
    const runner = new SyncRunner(dir, config);
    const result = await loadPlugins(runner, config);

    expect(result.loaded).toEqual([pluginDir]);
    expect(result.failed).toHaveLength(0);
    expect(runner.pluginCount).toBe(1);
  });
});
