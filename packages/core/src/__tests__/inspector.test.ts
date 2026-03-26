import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Inspector } from '../inspector.js';
import { TelemetryWriter } from '../telemetry.js';
import { RegistryManager } from '../registry.js';
import { DEFAULT_CONFIG } from '../config.js';
import { readJson } from '../storage.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillRun, PatternCache, SkillLoopConfig } from '../types.js';

const exec = promisify(execFile);

function makeRun(overrides: Partial<SkillRun> = {}): SkillRun {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    skillId: 'skill-1',
    skillVersion: 1,
    timestamp: new Date().toISOString(),
    platform: 'cli',
    taskContext: 'test',
    taskTags: [],
    outcome: 'success',
    durationMs: 100,
    ...overrides,
  };
}

describe('Inspector', () => {
  let dir: string;
  let telemetryDir: string;
  let config: SkillLoopConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-inspector-'));
    telemetryDir = join(dir, '.skill-telemetry');
    config = { ...DEFAULT_CONFIG };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  async function createSkillAndScan(name: string, body: string = 'Some instructions.'): Promise<string> {
    const skillDir = join(dir, '.claude', 'skills', name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      `description: "Test skill"`,
      '---',
      '',
      body,
    ].join('\n'));

    const manager = new RegistryManager(dir, telemetryDir);
    const registry = await manager.scan(['.claude/skills']);
    return registry.skills.find(s => s.name === name)!.id;
  }

  it('returns empty results when no skills exist', async () => {
    await mkdir(telemetryDir, { recursive: true });
    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();
    expect(result.skillCount).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(result.flagged).toHaveLength(0);
  });

  it('computes failure rate for a skill', async () => {
    const skillId = await createSkillAndScan('failing-skill');
    const writer = new TelemetryWriter(telemetryDir);

    // Log 4 failures and 1 success
    for (let i = 0; i < 4; i++) {
      await writer.logRun(makeRun({ skillId, outcome: 'failure', errorType: 'runtime_error' }));
    }
    await writer.logRun(makeRun({ skillId, outcome: 'success' }));

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].failureRate).toBe(0.8);
    expect(result.patterns[0].totalRuns).toBe(5);
    expect(result.patterns[0].dominantErrorType).toBe('runtime_error');
  });

  it('flags skills exceeding failure threshold', async () => {
    const skillId = await createSkillAndScan('bad-skill');
    const writer = new TelemetryWriter(telemetryDir);

    // 3 failures out of 5 = 60% > 20% threshold
    for (let i = 0; i < 3; i++) {
      await writer.logRun(makeRun({ skillId, outcome: 'failure' }));
    }
    for (let i = 0; i < 2; i++) {
      await writer.logRun(makeRun({ skillId, outcome: 'success' }));
    }

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();

    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].skillName).toBe('bad-skill');
    expect(result.flagged[0].severity).toBe('high');
  });

  it('does not flag healthy skills', async () => {
    const skillId = await createSkillAndScan('good-skill');
    const writer = new TelemetryWriter(telemetryDir);

    // All successes
    for (let i = 0; i < 10; i++) {
      await writer.logRun(makeRun({ skillId, outcome: 'success' }));
    }

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();

    expect(result.flagged).toHaveLength(0);
    expect(result.patterns[0].failureRate).toBe(0);
    expect(result.patterns[0].trend).toBe('stable');
  });

  it('detects broken file references', async () => {
    // Reference a file that doesn't exist
    const skillId = await createSkillAndScan('stale-skill', 'Check `src/lib/nonexistent.ts` for details.');
    const writer = new TelemetryWriter(telemetryDir);
    await writer.logRun(makeRun({ skillId, outcome: 'success' }));

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();

    expect(result.patterns[0].stalenessScore).toBe(1); // 1 broken out of 1 = 100%
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].reasons.some(r => r.includes('broken references'))).toBe(true);
  });

  it('writes pattern cache', async () => {
    const skillId = await createSkillAndScan('cached-skill');
    const writer = new TelemetryWriter(telemetryDir);
    await writer.logRun(makeRun({ skillId, outcome: 'success' }));

    const inspector = new Inspector(dir, telemetryDir, config);
    await inspector.inspect();

    const cache = await readJson<PatternCache>(join(telemetryDir, 'cache', 'patterns.json'));
    expect(cache).not.toBeNull();
    expect(cache!.patterns).toHaveLength(1);
    expect(cache!.builtAt).toBeDefined();
  });

  it('filters by skill name', async () => {
    const id1 = await createSkillAndScan('skill-a');
    const id2 = await createSkillAndScan('skill-b');
    const writer = new TelemetryWriter(telemetryDir);
    await writer.logRun(makeRun({ skillId: id1, outcome: 'success' }));
    await writer.logRun(makeRun({ skillId: id2, outcome: 'failure' }));

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect('skill-b');

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].failureRate).toBe(1);
  });

  it('detects content drift when referenced directories have new commits', async () => {
    // Initialize a git repo so countCommitsSince works
    await exec('git', ['init'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });

    // Create the referenced file and commit it
    await mkdir(join(dir, 'src', 'lib', 'world'), { recursive: true });
    await writeFile(join(dir, 'src', 'lib', 'world', 'layout.ts'), 'export const x = 1;');

    // Create the skill referencing that file
    const skillId = await createSkillAndScan(
      'map-skill',
      'See `src/lib/world/layout.ts` for the layout service.'
    );

    // Initial commit (includes skill + referenced file)
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'initial'], { cwd: dir });

    // Now make commits to the referenced directory AFTER the skill was last modified
    await writeFile(join(dir, 'src', 'lib', 'world', 'mask.ts'), 'export const mask = true;');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'add mask generator'], { cwd: dir });

    await writeFile(join(dir, 'src', 'lib', 'world', 'layout.ts'), 'export const x = 2; // updated');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'update layout'], { cwd: dir });

    // Backdate the skill's lastModified in the registry so drift is detected
    const { readFile: rf } = await import('node:fs/promises');
    const registryPath = join(telemetryDir, 'registry.json');
    const registry2 = JSON.parse(await rf(registryPath, 'utf-8'));
    const skill2 = registry2.skills.find((s: any) => s.name === 'map-skill');
    skill2.lastModified = new Date(Date.now() - 86_400_000).toISOString(); // 1 day ago
    await writeFile(registryPath, JSON.stringify(registry2));

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect('map-skill');

    // Should detect drift commits
    expect(result.patterns[0].driftScore).toBeGreaterThan(0);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.flagged[0].reasons.some(r => r.includes('Content drift'))).toBe(true);
  });

  it('detects degrading trend', async () => {
    const skillId = await createSkillAndScan('degrading-skill');
    const writer = new TelemetryWriter(telemetryDir);
    const now = Date.now();

    // First half: all success (older runs)
    for (let i = 0; i < 5; i++) {
      await writer.logRun(makeRun({
        skillId,
        outcome: 'success',
        timestamp: new Date(now - 20 * 24 * 60 * 60 * 1000 + i * 1000).toISOString(),
      }));
    }
    // Second half: all failures (recent runs)
    for (let i = 0; i < 5; i++) {
      await writer.logRun(makeRun({
        skillId,
        outcome: 'failure',
        timestamp: new Date(now - 5 * 24 * 60 * 60 * 1000 + i * 1000).toISOString(),
      }));
    }

    const inspector = new Inspector(dir, telemetryDir, config);
    const result = await inspector.inspect();

    expect(result.patterns[0].trend).toBe('degrading');
  });
});
