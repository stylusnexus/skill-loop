import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { gc } from '../gc.js';
import { appendJsonl, readJsonl, readJson } from '../storage.js';
import { DEFAULT_CONFIG } from '../config.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SkillRun, RunsIndex, SkillLoopConfig } from '../types.js';

function makeRun(daysAgo: number, overrides: Partial<SkillRun> = {}): SkillRun {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    skillId: 'skill-1',
    skillVersion: 1,
    timestamp: date.toISOString(),
    platform: 'cli',
    taskContext: 'test',
    taskTags: [],
    outcome: 'success',
    durationMs: 100,
    ...overrides,
  };
}

describe('gc', () => {
  let dir: string;
  let config: SkillLoopConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-gc-'));
    await mkdir(dir, { recursive: true });
    config = { ...DEFAULT_CONFIG, retention: { ...DEFAULT_CONFIG.retention, maxRunAgeDays: 30 } };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('prunes runs older than maxRunAgeDays', async () => {
    // 3 old runs (60 days ago) and 2 recent runs (5 days ago)
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(60));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(60));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(60));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(5));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(5));

    const result = await gc(dir, config);

    expect(result.runsBefore).toBe(5);
    expect(result.runsAfter).toBe(2);
    expect(result.pruned).toBe(3);

    const remaining = await readJsonl<SkillRun>(join(dir, 'runs.jsonl'));
    expect(remaining).toHaveLength(2);
  });

  it('rebuilds the index after gc', async () => {
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(60));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(5));

    await gc(dir, config);

    const index = await readJson<RunsIndex>(join(dir, 'runs-index.json'));
    expect(index).not.toBeNull();
    expect(index!.entries).toHaveLength(1);
  });

  it('handles empty runs file', async () => {
    const result = await gc(dir, config);
    expect(result.runsBefore).toBe(0);
    expect(result.pruned).toBe(0);
  });

  it('retains all runs if none are old enough', async () => {
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(1));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(10));
    await appendJsonl(join(dir, 'runs.jsonl'), makeRun(20));

    const result = await gc(dir, config);

    expect(result.pruned).toBe(0);
    expect(result.runsAfter).toBe(3);
  });
});
