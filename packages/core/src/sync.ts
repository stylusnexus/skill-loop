import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { SyncPlugin, SyncEvent, SkillRun, SanitizedSkillRun, SkillLoopConfig } from './types.js';
import { sanitizeRunForSync } from './sanitizer.js';
import { readJsonl, appendJsonl } from './storage.js';

const QUEUE_FILE = 'sync-queue.jsonl';
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

interface QueuedEvent {
  event: SyncEvent;
  pluginName: string;
  queuedAt: string;
}

export class SyncRunner {
  private plugins: SyncPlugin[] = [];
  private telemetryDir: string;
  private allowSensitiveFields: boolean;

  constructor(telemetryDir: string, config: SkillLoopConfig) {
    this.telemetryDir = telemetryDir;
    this.allowSensitiveFields = config.sync.allowSensitiveFields;
  }

  /** Register a sync plugin. */
  addPlugin(plugin: SyncPlugin): void {
    this.plugins.push(plugin);
  }

  /** Get registered plugin count. */
  get pluginCount(): number {
    return this.plugins.length;
  }

  /**
   * Emit a run_completed event to all interested plugins.
   * Core sanitizes the run BEFORE any plugin sees it.
   */
  async emitRunCompleted(run: SkillRun): Promise<void> {
    const sanitized = sanitizeRunForSync(run, this.allowSensitiveFields);
    const event: SyncEvent = { type: 'run_completed', payload: sanitized };

    for (const plugin of this.plugins) {
      if (!plugin.filter(sanitized)) continue;

      try {
        await plugin.emit(event);
      } catch {
        // Queue for retry — never block the local loop
        await this.enqueue(event, plugin.name);
      }
    }
  }

  /**
   * Emit a generic event (amendment_proposed, etc.) to all plugins.
   */
  async emitEvent(event: SyncEvent): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await plugin.emit(event);
      } catch {
        await this.enqueue(event, plugin.name);
      }
    }
  }

  /**
   * Flush the sync queue — retry queued events, prune expired ones.
   */
  async flush(): Promise<{ retried: number; expired: number; failed: number }> {
    const queuePath = join(this.telemetryDir, QUEUE_FILE);
    const queued = await readJsonl<QueuedEvent>(queuePath);

    if (queued.length === 0) {
      return { retried: 0, expired: 0, failed: 0 };
    }

    const now = Date.now();
    let retried = 0;
    let expired = 0;
    let failed = 0;
    const remaining: QueuedEvent[] = [];

    for (const item of queued) {
      const age = now - new Date(item.queuedAt).getTime();

      if (age > MAX_QUEUE_AGE_MS) {
        expired++;
        continue;
      }

      const plugin = this.plugins.find(p => p.name === item.pluginName);
      if (!plugin) {
        expired++;
        continue;
      }

      try {
        await plugin.emit(item.event);
        retried++;
      } catch {
        failed++;
        remaining.push(item);
      }
    }

    // Rewrite queue with only remaining items
    const content = remaining.map(r => JSON.stringify(r)).join('\n') + (remaining.length > 0 ? '\n' : '');
    await writeFile(queuePath, content, 'utf-8');

    return { retried, expired, failed };
  }

  /** Queue a failed event for later retry. */
  private async enqueue(event: SyncEvent, pluginName: string): Promise<void> {
    const queuePath = join(this.telemetryDir, QUEUE_FILE);
    const item: QueuedEvent = {
      event,
      pluginName,
      queuedAt: new Date().toISOString(),
    };
    await appendJsonl(queuePath, item);
  }
}
