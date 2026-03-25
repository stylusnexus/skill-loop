import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TelemetryWriter, loadConfig, readJson } from '@stylusnexus/skill-loop';
import type { SkillRun, SkillRegistry, RunOutcome } from '@stylusnexus/skill-loop';

interface HookOutput {
  tool_name: string;
  tool_result?: string;
  tool_error?: string;
}

interface PendingContext {
  runId: string;
  skillName: string;
  startedAt: string;
  taskContext: string;
}

export async function postHook(): Promise<void> {
  const input = await readStdin();
  if (!input) return;

  let hookOutput: HookOutput;
  try {
    hookOutput = JSON.parse(input);
  } catch {
    return;
  }

  if (hookOutput.tool_name !== 'Skill') return;

  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const telemetryDir = join(projectRoot, config.telemetryDir);
  const pendingDir = join(telemetryDir, '.pending');

  const pending = await findLatestPending(pendingDir);
  if (!pending) return;

  const registry = await readJson<SkillRegistry>(join(telemetryDir, 'registry.json'));
  const skill = registry?.skills.find(s => s.name === pending.skillName);

  const outcome: RunOutcome = hookOutput.tool_error ? 'failure' : 'success';
  const startTime = new Date(pending.startedAt).getTime();
  const durationMs = Date.now() - startTime;

  const run: SkillRun = {
    id: pending.runId,
    skillId: skill?.id ?? 'unknown',
    skillVersion: skill?.version ?? 0,
    timestamp: pending.startedAt,
    platform: 'claude',
    taskContext: pending.taskContext,
    taskTags: [],
    outcome,
    errorType: hookOutput.tool_error ? 'runtime_error' : undefined,
    errorDetail: hookOutput.tool_error?.slice(0, 500),
    durationMs,
  };

  const writer = new TelemetryWriter(telemetryDir);
  await writer.logRun(run);

  await rm(join(pendingDir, `${pending.runId}.json`), { force: true });
}

async function findLatestPending(pendingDir: string): Promise<PendingContext | null> {
  try {
    const files = await readdir(pendingDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    if (jsonFiles.length === 0) return null;

    const latest = jsonFiles[jsonFiles.length - 1];
    const content = await readFile(join(pendingDir, latest), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
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
