import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Amender } from '../amender.js';
import { TelemetryWriter } from '../telemetry.js';
import { RegistryManager } from '../registry.js';
import { DEFAULT_CONFIG } from '../config.js';
import { readJsonl } from '../storage.js';
import { getCurrentBranch, branchExists, checkoutBranch } from '../git.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillRun, Amendment, SkillLoopConfig } from '../types.js';
import type { FlaggedSkill } from '../inspector.js';

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

describe('Amender', () => {
  let dir: string;
  let telemetryDir: string;
  let config: SkillLoopConfig;
  let originalBranch: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-amender-'));
    telemetryDir = join(dir, '.skill-telemetry');

    // Init git repo
    await exec('git', ['init'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Test');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init'], { cwd: dir });
    originalBranch = await getCurrentBranch(dir);

    config = { ...DEFAULT_CONFIG };
  });

  afterEach(async () => {
    // Ensure we're on the original branch before cleanup
    try { await checkoutBranch(dir, originalBranch); } catch {}
    await rm(dir, { recursive: true });
  });

  async function createSkillAndScan(name: string, body: string): Promise<string> {
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

    // Commit the skill file so git is clean
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', `add ${name}`], { cwd: dir });

    const manager = new RegistryManager(dir, telemetryDir);
    const registry = await manager.scan(['.claude/skills']);
    return registry.skills.find(s => s.name === name)!.id;
  }

  it('generates proposal for broken references in dry-run mode', async () => {
    const skillId = await createSkillAndScan('stale-skill', 'Check `src/nonexistent.ts` for help.');
    const writer = new TelemetryWriter(telemetryDir);
    await writer.logRun(makeRun({ skillId, outcome: 'success' }));

    const flagged: FlaggedSkill[] = [{
      skillId,
      skillName: 'stale-skill',
      reasons: ['Staleness score 1.00 — 1 broken references'],
      severity: 'medium',
    }];

    // Update broken references in registry to match
    const { readJson, writeJsonAtomic } = await import('../storage.js');
    const registry = await readJson<any>(join(telemetryDir, 'registry.json'));
    const skill = registry.skills.find((s: any) => s.id === skillId);
    skill.brokenReferences = ['src/nonexistent.ts'];
    await writeJsonAtomic(join(telemetryDir, 'registry.json'), registry);

    const amender = new Amender(dir, telemetryDir, config);
    const result = await amender.amend(flagged, true); // dry run

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].changeType).toBe('reference');
    expect(result.proposals[0].proposedContent).toContain('file not found');
    expect(result.applied).toHaveLength(0); // dry run
  });

  it('creates branch and commits amendment when not dry-run', async () => {
    const skillId = await createSkillAndScan('failing-skill', '# Failing Skill\n\nDo stuff.');
    const writer = new TelemetryWriter(telemetryDir);

    // Log failures with error details
    for (let i = 0; i < 5; i++) {
      await writer.logRun(makeRun({
        skillId,
        outcome: 'failure',
        errorType: 'runtime_error',
        errorDetail: 'Tool Bash failed: command not found',
      }));
    }

    const flagged: FlaggedSkill[] = [{
      skillId,
      skillName: 'failing-skill',
      reasons: ['Failure rate 100% exceeds threshold 20%'],
      severity: 'high',
    }];

    const amender = new Amender(dir, telemetryDir, config);
    const result = await amender.amend(flagged, false);

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].status).toBe('proposed');
    expect(result.applied[0].branchName).toMatch(/^skill-loop\/amend-failing-skill-/);
    expect(result.applied[0].changeType).toBe('instruction');

    // Branch should exist
    expect(await branchExists(dir, result.applied[0].branchName!)).toBe(true);

    // Should be back on original branch
    expect(await getCurrentBranch(dir)).toBe(originalBranch);

    // Amendment should be recorded in JSONL
    const amendments = await readJsonl<Amendment>(join(telemetryDir, 'amendments.jsonl'));
    expect(amendments).toHaveLength(1);
    expect(amendments[0].id).toBe(result.applied[0].id);
  });

  it('skips skills not in registry', async () => {
    await mkdir(telemetryDir, { recursive: true });
    // Write empty registry
    const { writeJsonAtomic } = await import('../storage.js');
    await writeJsonAtomic(join(telemetryDir, 'registry.json'), { schemaVersion: 1, skills: [] });

    const flagged: FlaggedSkill[] = [{
      skillId: 'nonexistent',
      skillName: 'ghost-skill',
      reasons: ['some reason'],
      severity: 'low',
    }];

    const amender = new Amender(dir, telemetryDir, config);
    const result = await amender.amend(flagged, true);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('ghost-skill');
  });
});
