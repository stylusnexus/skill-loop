import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryWriter } from '../telemetry.js';
import { readJsonl, readJson } from '../storage.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SkillRun, RunsIndex } from '../types.js';

function makeRun(overrides: Partial<SkillRun> = {}): SkillRun {
  return {
    id: overrides.id || 'run-1',
    skillId: 'skill-1',
    skillVersion: 1,
    timestamp: new Date().toISOString(),
    platform: 'cli',
    taskContext: 'test task',
    taskTags: [],
    outcome: 'success',
    durationMs: 100,
    ...overrides,
  };
}

describe('TelemetryWriter', () => {
  let dir: string;
  let writer: TelemetryWriter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-telemetry-'));
    writer = new TelemetryWriter(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('appends a run to runs.jsonl', async () => {
    const run = makeRun();
    await writer.logRun(run);
    const runs = await readJsonl<SkillRun>(join(dir, 'runs.jsonl'));
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('run-1');
  });

  it('appends multiple runs in order', async () => {
    await writer.logRun(makeRun({ id: 'r1' }));
    await writer.logRun(makeRun({ id: 'r2' }));
    await writer.logRun(makeRun({ id: 'r3' }));
    const runs = await readJsonl<SkillRun>(join(dir, 'runs.jsonl'));
    expect(runs.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('updates the runs index', async () => {
    await writer.logRun(makeRun({ id: 'r1', outcome: 'success' }));
    await writer.logRun(makeRun({ id: 'r2', outcome: 'failure' }));
    const index = await readJson<RunsIndex>(join(dir, 'runs-index.json'));
    expect(index).not.toBeNull();
    expect(index!.entries).toHaveLength(2);
    expect(index!.entries[0].id).toBe('r1');
    expect(index!.entries[1].outcome).toBe('failure');
  });

  it('reads run count', async () => {
    await writer.logRun(makeRun({ id: 'r1' }));
    await writer.logRun(makeRun({ id: 'r2' }));
    const count = await writer.getRunCount();
    expect(count).toBe(2);
  });
});
