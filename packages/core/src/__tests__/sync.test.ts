import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncRunner } from '../sync.js';
import { DEFAULT_CONFIG } from '../config.js';
import { readJsonl } from '../storage.js';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SyncPlugin, SyncEvent, SanitizedSkillRun, SkillRun, SkillLoopConfig } from '../types.js';

const baseRun: SkillRun = {
  id: 'run-1',
  skillId: 'skill-1',
  skillVersion: 1,
  timestamp: '2026-03-24T12:00:00Z',
  platform: 'claude',
  taskContext: 'sensitive user task description',
  taskTags: ['test'],
  outcome: 'success',
  durationMs: 100,
};

function makePlugin(overrides: Partial<SyncPlugin> = {}): SyncPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    filter: () => true,
    emit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SyncRunner', () => {
  let dir: string;
  let config: SkillLoopConfig;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-sync-'));
    await mkdir(dir, { recursive: true });
    config = { ...DEFAULT_CONFIG };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('sanitizes runs before passing to plugins (sensitive fields redacted)', async () => {
    const plugin = makePlugin();
    const runner = new SyncRunner(dir, config);
    runner.addPlugin(plugin);

    await runner.emitRunCompleted(baseRun);

    expect(plugin.emit).toHaveBeenCalledOnce();
    const emittedEvent = (plugin.emit as any).mock.calls[0][0] as SyncEvent;
    expect(emittedEvent.type).toBe('run_completed');
    const payload = emittedEvent.payload as SanitizedSkillRun;
    expect(payload.taskContext).toBe('[redacted]');
    expect(payload.id).toBe('run-1');
    expect(payload.outcome).toBe('success');
  });

  it('passes sensitive fields when allowSensitiveFields is true', async () => {
    const plugin = makePlugin();
    const sensitiveConfig = { ...config, sync: { ...config.sync, allowSensitiveFields: true } };
    const runner = new SyncRunner(dir, sensitiveConfig);
    runner.addPlugin(plugin);

    await runner.emitRunCompleted(baseRun);

    const emittedEvent = (plugin.emit as any).mock.calls[0][0] as SyncEvent;
    const payload = emittedEvent.payload as SanitizedSkillRun;
    expect(payload.taskContext).toBe('sensitive user task description');
  });

  it('respects plugin filter', async () => {
    const plugin = makePlugin({ filter: (run) => run.outcome === 'failure' });
    const runner = new SyncRunner(dir, config);
    runner.addPlugin(plugin);

    await runner.emitRunCompleted(baseRun); // outcome is 'success'

    expect(plugin.emit).not.toHaveBeenCalled();
  });

  it('queues events when plugin emit fails', async () => {
    const plugin = makePlugin({ emit: vi.fn().mockRejectedValue(new Error('network')) });
    const runner = new SyncRunner(dir, config);
    runner.addPlugin(plugin);

    await runner.emitRunCompleted(baseRun);

    const queue = await readJsonl(join(dir, 'sync-queue.jsonl'));
    expect(queue).toHaveLength(1);
  });

  it('flushes queued events on retry', async () => {
    // First: fail so it queues
    const emitFn = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const plugin = makePlugin({ emit: emitFn });
    const runner = new SyncRunner(dir, config);
    runner.addPlugin(plugin);

    await runner.emitRunCompleted(baseRun); // fails, queued

    // Second: flush succeeds
    const result = await runner.flush();
    expect(result.retried).toBe(1);
    expect(result.failed).toBe(0);

    // Queue should be empty now
    const queue = await readJsonl(join(dir, 'sync-queue.jsonl'));
    expect(queue).toHaveLength(0);
  });

  it('expires old queued events beyond TTL', async () => {
    // Manually write an old queued event
    const { appendJsonl: append } = await import('../storage.js');
    await append(join(dir, 'sync-queue.jsonl'), {
      event: { type: 'run_completed', payload: {} },
      pluginName: 'test-plugin',
      queuedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
    });

    const plugin = makePlugin();
    const runner = new SyncRunner(dir, config);
    runner.addPlugin(plugin);

    const result = await runner.flush();
    expect(result.expired).toBe(1);
    expect(result.retried).toBe(0);
  });
});
