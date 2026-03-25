import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface HookInput {
  tool_name: string;
  tool_input: {
    skill?: string;
    [key: string]: unknown;
  };
}

interface PendingContext {
  runId: string;
  skillName: string;
  startedAt: string;
  taskContext: string;
}

export async function preHook(): Promise<void> {
  const input = await readStdin();
  if (!input) return;

  let hookInput: HookInput;
  try {
    hookInput = JSON.parse(input);
  } catch {
    return;
  }

  if (hookInput.tool_name !== 'Skill') return;

  const skillName = hookInput.tool_input?.skill;
  if (!skillName) return;

  const pendingDir = join(process.cwd(), '.skill-telemetry', '.pending');
  await mkdir(pendingDir, { recursive: true });

  const runId = randomUUID();
  const context: PendingContext = {
    runId,
    skillName,
    startedAt: new Date().toISOString(),
    taskContext: typeof hookInput.tool_input === 'object'
      ? JSON.stringify(hookInput.tool_input).slice(0, 200)
      : '',
  };

  await writeFile(join(pendingDir, `${runId}.json`), JSON.stringify(context));
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 1000);
  });
}
