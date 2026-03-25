import { loadConfig, readJson, readJsonl } from '@stylusnexus/skill-loop';
import type { SkillRegistry, RunsIndex, SkillRun } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat, readdir } from 'node:fs/promises';

export async function doctorCommand(projectRoot: string): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  console.log('Running diagnostics...\n');
  let issues = 0;

  // 1. Check registry exists
  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  if (!registry) {
    console.log('[WARN] registry.json is missing. Run `npx skill-loop init`.');
    issues++;
  } else {
    console.log(`[OK] Registry: ${registry.skills.length} skills, schema v${registry.schemaVersion}`);
  }

  // 2. Check runs reference valid skill IDs
  const runs = await readJsonl<SkillRun>(join(telemetryDir, 'runs.jsonl'));
  const skillIds = new Set(registry?.skills.map(s => s.id) ?? []);
  const orphanedRuns = runs.filter(r => !skillIds.has(r.skillId) && r.skillId !== 'unknown');
  if (orphanedRuns.length > 0) {
    console.log(`[WARN] ${orphanedRuns.length} runs reference skills not in registry (deleted skills?)`);
    issues++;
  } else {
    console.log(`[OK] All ${runs.length} runs reference valid skill IDs`);
  }

  // 3. Check index matches runs
  const index = await readJson<RunsIndex>(join(telemetryDir, 'runs-index.json'));
  if (index) {
    if (index.entries.length !== runs.length) {
      console.log(`[WARN] Index has ${index.entries.length} entries but runs.jsonl has ${runs.length} — index may be stale`);
      issues++;
    } else {
      console.log(`[OK] Index is in sync with runs (${index.entries.length} entries)`);
    }
  } else if (runs.length > 0) {
    console.log('[WARN] runs-index.json is missing but runs exist');
    issues++;
  }

  // 4. Check file sizes
  const runsSize = await safeFileSize(join(telemetryDir, 'runs.jsonl'));
  const maxBytes = config.retention.maxFileSizeMB * 1024 * 1024;
  if (runsSize > maxBytes) {
    console.log(`[WARN] runs.jsonl is ${formatSize(runsSize)} (exceeds ${config.retention.maxFileSizeMB}MB limit). Run \`npx skill-loop gc\`.`);
    issues++;
  } else {
    console.log(`[OK] runs.jsonl size: ${formatSize(runsSize)}`);
  }

  // 5. Check for stale pending contexts
  const pendingDir = join(telemetryDir, '.pending');
  try {
    const pending = await readdir(pendingDir);
    if (pending.length > 5) {
      console.log(`[WARN] ${pending.length} pending hook contexts (may indicate hook failures)`);
      issues++;
    } else if (pending.length > 0) {
      console.log(`[OK] ${pending.length} pending hook contexts`);
    }
  } catch {
    // No pending dir is fine
  }

  console.log(`\nDiagnostics complete: ${issues === 0 ? 'all healthy' : `${issues} issue(s) found`}`);
}

async function safeFileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '(empty)';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
