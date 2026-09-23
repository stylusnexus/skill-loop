import { describe, it, expect } from 'vitest';
import { claudeHookCommand } from '@stylusnexus/skill-loop';
import { upgradeHookCommands } from '../commands/init.js';

describe('upgradeHookCommands', () => {
  it('rewrites pinned and bare npx hook commands in nested hook entries', () => {
    const entries = [
      { matcher: '*', hooks: [{ type: 'command', command: 'npx -y -p @stylusnexus/skill-loop-cli@0.2.4 skill-loop-claude pre-hook' }] },
      { matcher: '.*', hooks: [{ type: 'command', command: 'npx --package=@stylusnexus/skill-loop skill-loop-claude pre-hook' }] },
    ];

    expect(upgradeHookCommands(entries, 'pre-hook')).toBe(2);
    expect(entries.map((e) => e.hooks[0].command)).toEqual([
      claudeHookCommand('pre-hook'),
      claudeHookCommand('pre-hook'),
    ]);
  });

  it('leaves current and unrelated hook commands alone', () => {
    const entries = [
      { hooks: [{ type: 'command', command: claudeHookCommand('post-hook') }] },
      { hooks: [{ type: 'command', command: 'python3 other-hook.py' }] },
    ];

    expect(upgradeHookCommands(entries, 'post-hook')).toBe(0);
    expect(entries[1].hooks[0].command).toBe('python3 other-hook.py');
  });

  it('rewrites a flat legacy entry that carries the command directly', () => {
    const entries = [{ matcher: 'Skill', command: 'npx skill-loop-claude pre-hook' }];

    expect(upgradeHookCommands(entries, 'pre-hook')).toBe(1);
    expect(entries[0].command).toBe(claudeHookCommand('pre-hook'));
  });
});
