import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSkillFile, extractReferencedFiles, extractReferencedTools } from '../parser.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Parser', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  describe('parseSkillFile', () => {
    it('parses standard SKILL.md frontmatter', async () => {
      const skillDir = join(dir, 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), [
        '---',
        'name: test-skill',
        'description: "A test skill for unit testing"',
        '---',
        '',
        '# Test Skill',
        '',
        'Do the thing with `src/lib/foo.ts` and `src/lib/bar.ts`.',
        '',
        'Use the Bash tool to run commands.',
        'Use the Grep tool to search.',
      ].join('\n'));

      const result = await parseSkillFile(join(skillDir, 'SKILL.md'));
      expect(result.name).toBe('test-skill');
      expect(result.description).toBe('A test skill for unit testing');
      expect(result.body).toContain('# Test Skill');
    });

    it('handles missing description gracefully', async () => {
      const skillDir = join(dir, 'minimal');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), [
        '---',
        'name: minimal',
        '---',
        '',
        'Just a body.',
      ].join('\n'));

      const result = await parseSkillFile(join(skillDir, 'SKILL.md'));
      expect(result.name).toBe('minimal');
      expect(result.description).toBe('');
    });

    it('handles file with no frontmatter', async () => {
      const skillDir = join(dir, 'no-front');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Just markdown\n\nNo frontmatter here.');

      const result = await parseSkillFile(join(skillDir, 'SKILL.md'));
      expect(result.name).toBe('');
      expect(result.body).toContain('# Just markdown');
    });
  });

  describe('extractReferencedFiles', () => {
    it('extracts backtick-quoted file paths', () => {
      const body = 'Check `src/lib/foo.ts` and `src/components/Bar.tsx` for details.';
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('src/lib/foo.ts');
      expect(refs).toContain('src/components/Bar.tsx');
    });

    it('ignores non-path backtick content', () => {
      const body = 'Use `npm run build` and check `true` values.';
      const refs = extractReferencedFiles(body);
      expect(refs).toEqual([]);
    });
  });

  describe('extractReferencedTools', () => {
    it('extracts Claude Code tool names', () => {
      const body = 'Use the Bash tool to run.\nUse Grep to search.\nRead the file.';
      const tools = extractReferencedTools(body);
      expect(tools).toContain('Bash');
      expect(tools).toContain('Grep');
      expect(tools).toContain('Read');
    });
  });
});
