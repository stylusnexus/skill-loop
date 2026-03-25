import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { SkillRun, RunsIndex, SkillLoopConfig } from './types.js';
import { readJsonl, writeJsonAtomic } from './storage.js';

export interface GcResult {
  runsBefore: number;
  runsAfter: number;
  pruned: number;
  oldestRetained: string | null;
}

/**
 * Prune runs older than maxRunAgeDays from runs.jsonl and rebuild the index.
 */
export async function gc(telemetryDir: string, config: SkillLoopConfig): Promise<GcResult> {
  const runsPath = join(telemetryDir, 'runs.jsonl');
  const indexPath = join(telemetryDir, 'runs-index.json');

  const allRuns = await readJsonl<SkillRun>(runsPath);
  const runsBefore = allRuns.length;

  if (runsBefore === 0) {
    return { runsBefore: 0, runsAfter: 0, pruned: 0, oldestRetained: null };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.retention.maxRunAgeDays);

  const retained = allRuns.filter(r => new Date(r.timestamp) >= cutoff);
  const pruned = runsBefore - retained.length;

  // Rewrite runs.jsonl with only retained runs
  const runsContent = retained.map(r => JSON.stringify(r)).join('\n') + (retained.length > 0 ? '\n' : '');
  await writeFile(runsPath, runsContent, 'utf-8');

  // Rebuild index from retained runs
  const index: RunsIndex = {
    builtAt: new Date().toISOString(),
    entries: retained.map(r => ({
      id: r.id,
      skillId: r.skillId,
      skillVersion: r.skillVersion,
      timestamp: r.timestamp,
      outcome: r.outcome,
      platform: r.platform,
    })),
  };
  await writeJsonAtomic(indexPath, index);

  const oldestRetained = retained.length > 0
    ? retained.reduce((a, b) => new Date(a.timestamp) < new Date(b.timestamp) ? a : b).timestamp
    : null;

  return { runsBefore, runsAfter: retained.length, pruned, oldestRetained };
}
