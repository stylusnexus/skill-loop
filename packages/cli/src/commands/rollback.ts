import { loadConfig, readJsonl } from '@stylusnexus/skill-loop';
import type { Amendment } from '@stylusnexus/skill-loop';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function rollbackCommand(projectRoot: string, args: string[]): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  const amendmentId = args[0];
  if (!amendmentId) {
    console.error('Usage: skill-loop rollback <amendment-id>');
    process.exit(1);
  }

  const amendments = await readJsonl<Amendment>(join(telemetryDir, 'amendments.jsonl'));
  const amendment = amendments.find(a => a.id === amendmentId);

  if (!amendment) {
    console.error(`Amendment ${amendmentId.slice(0, 8)} not found.`);
    process.exit(1);
  }

  if (amendment.status !== 'accepted') {
    console.error(`Amendment ${amendmentId.slice(0, 8)} is ${amendment.status} — can only rollback accepted amendments.`);
    process.exit(1);
  }

  console.log(`Rolling back amendment ${amendmentId.slice(0, 8)}...`);
  console.log(`  Skill: ${amendment.skillId.slice(0, 8)}`);
  console.log(`  Change: ${amendment.changeType}`);
  console.log(`  Reason: ${amendment.reason}\n`);

  // Update amendment status
  const updated = amendments.map(a => {
    if (a.id === amendmentId) {
      return { ...a, status: 'rolled_back' as const, rollbackAt: new Date().toISOString() };
    }
    return a;
  });
  const content = updated.map(a => JSON.stringify(a)).join('\n') + '\n';
  await writeFile(join(telemetryDir, 'amendments.jsonl'), content, 'utf-8');

  console.log('Amendment marked as rolled_back.');
  console.log('To revert the git changes, run: git revert <commit-hash>');
}
