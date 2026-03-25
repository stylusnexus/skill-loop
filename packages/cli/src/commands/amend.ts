import { Inspector, Amender, loadConfig } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function amendCommand(projectRoot: string, args: string[]): Promise<void> {
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  try {
    await stat(telemetryDir);
  } catch {
    console.log('skill-loop is not initialized. Run `npx skill-loop init` first.');
    return;
  }

  const dryRun = args.includes('--dry-run');
  let skillName: string | undefined;
  const skillIdx = args.indexOf('--skill');
  if (skillIdx !== -1 && args[skillIdx + 1]) {
    skillName = args[skillIdx + 1];
  }

  // First run inspection to find flagged skills
  console.log('Inspecting skills...\n');
  const inspector = new Inspector(projectRoot, telemetryDir, config);
  const inspection = await inspector.inspect(skillName);

  if (inspection.flagged.length === 0) {
    console.log('No skills flagged for amendment. All skills are healthy.');
    return;
  }

  console.log(`Found ${inspection.flagged.length} flagged skill(s):\n`);
  for (const flag of inspection.flagged) {
    const icon = flag.severity === 'high' ? '[HIGH]' : flag.severity === 'medium' ? '[MED]' : '[LOW]';
    console.log(`  ${icon} ${flag.skillName}`);
    for (const reason of flag.reasons) {
      console.log(`    - ${reason}`);
    }
  }

  if (dryRun) {
    console.log('\n--- DRY RUN ---\n');
  }

  const amender = new Amender(projectRoot, telemetryDir, config);
  const result = await amender.amend(inspection.flagged, dryRun);

  if (result.proposals.length > 0) {
    console.log(`\nProposals (${result.proposals.length}):`);
    for (const p of result.proposals) {
      console.log(`  ${p.skillName} (${p.changeType}): ${p.reason}`);
    }
  }

  if (result.applied.length > 0) {
    console.log(`\nApplied amendments (${result.applied.length}):`);
    for (const a of result.applied) {
      console.log(`  ${a.id.slice(0, 8)} on branch ${a.branchName}`);
      console.log(`    Run \`npx skill-loop evaluate ${a.id}\` to test this amendment.`);
    }
  }

  if (result.skipped.length > 0) {
    console.log(`\nSkipped (${result.skipped.length}):`);
    for (const s of result.skipped) {
      console.log(`  ${s}`);
    }
  }
}
