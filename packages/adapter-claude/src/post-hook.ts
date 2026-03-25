import { join } from 'node:path';
import { DetectionPipeline, loadConfig } from '@stylusnexus/skill-loop';
import type { PostEvent } from '@stylusnexus/skill-loop';

export async function postHook(): Promise<void> {
  const input = await readStdin();
  if (!input) return;

  let hookOutput: { tool_name: string; tool_input?: Record<string, unknown>; tool_result?: unknown; tool_error?: string; session_id?: string };
  try {
    hookOutput = JSON.parse(input);
  } catch {
    return;
  }

  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);

  const event: PostEvent = {
    tool_name: hookOutput.tool_name,
    tool_input: hookOutput.tool_input,
    tool_result: hookOutput.tool_result,
    tool_error: hookOutput.tool_error,
    session_id: hookOutput.session_id,
  };

  const pipeline = new DetectionPipeline(projectRoot, telemetryDir, config.detection);
  await pipeline.handlePostEvent(event);
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
