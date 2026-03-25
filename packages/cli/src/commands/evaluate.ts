import { Evaluator, loadConfig } from '@stylusnexus/skill-loop';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export async function evaluateCommand(projectRoot: string, args: string[]): Promise<void> {
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
    console.error('Usage: skill-loop evaluate <amendment-id>');
    process.exit(1);
  }

  console.log(`Evaluating amendment ${amendmentId.slice(0, 8)}...\n`);

  const evaluator = new Evaluator(projectRoot, telemetryDir, config);
  const result = await evaluator.evaluate(amendmentId);

  console.log(`Baseline score:   ${(result.baselineScore * 100).toFixed(1)}%`);
  console.log(`Evaluation score: ${(result.evaluationScore * 100).toFixed(1)}%`);
  console.log(`Evidence runs:    ${result.evaluationRunCount}`);
  console.log(`Result:           ${result.passed ? 'PASSED' : 'REJECTED'}`);
  console.log(`Reason:           ${result.reason}`);

  if (result.passed) {
    console.log('\nAmendment accepted. Review the branch and merge when ready.');
  } else {
    console.log('\nAmendment rejected. Branch has been cleaned up.');
  }
}
