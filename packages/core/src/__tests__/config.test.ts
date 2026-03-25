import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../config.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Config', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('merges user config over defaults', async () => {
    await writeFile(
      join(dir, 'skill-loop.config.json'),
      JSON.stringify({ skillPaths: ['.custom/skills'], thresholds: { failureRateAlert: 0.5 } })
    );
    const config = await loadConfig(dir);
    expect(config.skillPaths).toEqual(['.custom/skills']);
    expect(config.thresholds.failureRateAlert).toBe(0.5);
    expect(config.thresholds.deadSkillDays).toBe(DEFAULT_CONFIG.thresholds.deadSkillDays);
    expect(config.telemetryDir).toBe('.skill-telemetry');
  });

  it('handles invalid JSON gracefully', async () => {
    await writeFile(join(dir, 'skill-loop.config.json'), 'not json{{{');
    const config = await loadConfig(dir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
