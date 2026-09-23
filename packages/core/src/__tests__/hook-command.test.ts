import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeHookCommand } from '../adapters/claude/hook-command.js';

let bin: string;

async function fakeBinary(name: string, script: string): Promise<void> {
  const path = join(bin, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
}

function run(command: string, input = '{"tool_name":"Read"}') {
  return spawnSync('/bin/sh', ['-c', command], {
    input,
    encoding: 'utf-8',
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
}

describe('claudeHookCommand', () => {
  beforeEach(async () => {
    bin = await mkdtemp(join(tmpdir(), 'hook-command-'));
  });

  afterEach(async () => {
    await rm(bin, { recursive: true, force: true });
  });

  it('runs an installed skill-loop-claude directly with the event name and hook input', async () => {
    await fakeBinary('skill-loop-claude', 'echo "direct $1 $(cat)"');
    await fakeBinary('npx', 'echo "npx $*"');

    const result = run(claudeHookCommand('pre-hook'));

    expect(result.stdout.trim()).toBe('direct pre-hook {"tool_name":"Read"}');
  });

  it('falls back to npx when skill-loop-claude is not installed', async () => {
    await fakeBinary('npx', 'echo "npx $* $(cat)"');

    const result = run(claudeHookCommand('post-hook'));

    expect(result.stdout.trim()).toBe(
      'npx --package=@stylusnexus/skill-loop skill-loop-claude post-hook {"tool_name":"Read"}'
    );
  });

  it('keeps a blocking exit code without rerunning through npx', async () => {
    await fakeBinary('skill-loop-claude', 'echo blocked >&2; exit 2');
    await fakeBinary('npx', 'echo "npx ran"');

    const result = run(claudeHookCommand('pre-hook'));

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('npx ran');
  });
});
