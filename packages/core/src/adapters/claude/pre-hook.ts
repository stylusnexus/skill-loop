import { join } from 'node:path';
import { DetectionPipeline } from '../../detector.js';
import { loadConfig } from '../../config.js';
import type { PreEvent } from '../../detector.js';

export async function preHook(): Promise<void> {
  const input = await readStdin();
  if (!input) return;

  let hookInput: { tool_name: string; tool_input: Record<string, unknown>; session_id?: string };
  try {
    hookInput = JSON.parse(input);
  } catch {
    return;
  }

  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const event: PreEvent = {
    tool_name: hookInput.tool_name,
    tool_input: hookInput.tool_input ?? {},
    session_id: hookInput.session_id,
  };

  const pipeline = new DetectionPipeline(projectRoot, telemetryDir, config.detection);
  await pipeline.handlePreEvent(event);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(data); } };
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', done);
    setTimeout(done, 1000);
  });
}
