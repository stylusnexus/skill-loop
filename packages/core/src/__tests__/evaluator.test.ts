import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Evaluator } from '../evaluator.js';
import { DEFAULT_CONFIG } from '../config.js';
import { appendJsonl, readJsonl } from '../storage.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Amendment, SkillRun, SkillLoopConfig } from '../types.js';

const execFileAsync = promisify(execFile);

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

function makeAmendment(overrides: Partial<Amendment> = {}): Amendment {
  return {
    id: 'amend-1',
    skillId: 'skill-1',
    skillVersion: 1,
    proposedAt: new Date().toISOString(),
    reason: 'test amendment',
    changeType: 'reference',
    diff: '--- a/skill.md\n+++ b/skill.md\n',
    evidence: ['run-fail-1', 'run-fail-2'],
    evidenceSummary: { failureRate: 0.5, sampleSize: 10, timeWindowDays: 30 },
    status: 'proposed',
    branchName: 'skill-loop/amend-test-abc12345',
    ...overrides,
  };
}

describe('Evaluator', () => {
  let dir: string;
  let telemetryDir: string;
  let config: SkillLoopConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-evaluator-'));
    telemetryDir = join(dir, '.skill-telemetry');
    await mkdir(telemetryDir, { recursive: true });

    // Init git repo
    await execFileAsync('git', ['init'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Test');
    await execFileAsync('git', ['add', '.'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });

    config = { ...DEFAULT_CONFIG };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('returns not-found for missing amendment', async () => {
    const evaluator = new Evaluator(dir, telemetryDir, config);
    const result = await evaluator.evaluate('nonexistent');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('rejects non-proposed amendments', async () => {
    await appendJsonl(join(telemetryDir, 'amendments.jsonl'), makeAmendment({ status: 'accepted' }));

    const evaluator = new Evaluator(dir, telemetryDir, config);
    const result = await evaluator.evaluate('amend-1');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('already accepted');
  });

  it('accepts amendment that improves on low baseline', async () => {
    // Baseline: 20% success (mostly failures)
    for (let i = 0; i < 8; i++) {
      await appendJsonl(join(telemetryDir, 'runs.jsonl'), makeRun({ outcome: 'failure', id: `run-fail-${i}` }));
    }
    for (let i = 0; i < 2; i++) {
      await appendJsonl(join(telemetryDir, 'runs.jsonl'), makeRun({ outcome: 'success' }));
    }

    // Amendment fixing broken references (high confidence, +0.3 boost)
    await appendJsonl(join(telemetryDir, 'amendments.jsonl'), makeAmendment({
      changeType: 'reference',
      evidence: ['run-fail-0', 'run-fail-1', 'run-fail-2'],
    }));

    const evaluator = new Evaluator(dir, telemetryDir, config);
    const result = await evaluator.evaluate('amend-1');

    expect(result.passed).toBe(true);
    expect(result.evaluationScore).toBeGreaterThan(result.baselineScore);
    expect(result.baselineScore).toBeCloseTo(0.2, 1);
  });

  it('rejects amendment when baseline is already high', async () => {
    // Baseline: 90% success
    for (let i = 0; i < 9; i++) {
      await appendJsonl(join(telemetryDir, 'runs.jsonl'), makeRun({ outcome: 'success' }));
    }
    await appendJsonl(join(telemetryDir, 'runs.jsonl'), makeRun({ outcome: 'failure', id: 'run-fail-0' }));

    // Instruction amendment (+0.15 boost) won't clear the 10% improvement threshold from 90%
    await appendJsonl(join(telemetryDir, 'amendments.jsonl'), makeAmendment({
      changeType: 'instruction',
      evidence: ['run-fail-0'],
    }));

    const evaluator = new Evaluator(dir, telemetryDir, config);
    const result = await evaluator.evaluate('amend-1');

    // Score would be 0.9 + 0.15 = 1.05 capped at 1.0
    // But evidence < 3, so 1.0 * 0.8 = 0.8, which is less than 0.9 + 0.1 = 1.0
    // So it should be rejected
    expect(result.passed).toBe(false);
  });

  it('updates amendment status in JSONL after evaluation', async () => {
    for (let i = 0; i < 5; i++) {
      await appendJsonl(join(telemetryDir, 'runs.jsonl'), makeRun({ outcome: 'failure', id: `run-fail-${i}` }));
    }

    await appendJsonl(join(telemetryDir, 'amendments.jsonl'), makeAmendment({
      changeType: 'reference',
      evidence: ['run-fail-0', 'run-fail-1', 'run-fail-2'],
    }));

    const evaluator = new Evaluator(dir, telemetryDir, config);
    await evaluator.evaluate('amend-1');

    const amendments = await readJsonl<Amendment>(join(telemetryDir, 'amendments.jsonl'));
    expect(amendments[0].status).not.toBe('proposed'); // Should be accepted or rejected
    expect(amendments[0].evaluationScore).toBeDefined();
    expect(amendments[0].baselineScore).toBeDefined();
  });
});
