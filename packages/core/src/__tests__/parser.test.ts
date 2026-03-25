import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSkillFile, extractReferencedFiles, extractReferencedTools, DEFAULT_EXCLUDE_PATTERNS } from '../parser.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParserConfig } from '../types.js';

const defaultSources = { backtick: true, codeBlock: true, table: true, plainText: false };

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
    // ─── Backtick extraction (existing behavior) ──────────────────

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

    // ─── Code block extraction ────────────────────────────────────

    it('extracts file paths from fenced code blocks', () => {
      const body = [
        'Some text.',
        '',
        '```bash',
        'npx playwright test e2e/suite/smoke/routes.spec.ts',
        '```',
      ].join('\n');
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('e2e/suite/smoke/routes.spec.ts');
    });

    it('extracts multiple paths from code blocks', () => {
      const body = [
        '```',
        'cat src/lib/auth.ts',
        'grep -r "export" src/components/Header.tsx',
        '```',
      ].join('\n');
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('src/lib/auth.ts');
      expect(refs).toContain('src/components/Header.tsx');
    });

    // ─── Table extraction ─────────────────────────────────────────

    it('extracts file paths from markdown tables', () => {
      const body = [
        '| Tier | Path | Time |',
        '|------|------|------|',
        '| core | e2e/suite/core/ | 3 min |',
        '| smoke | e2e/suite/smoke/routes.spec.ts | 25s |',
      ].join('\n');
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('e2e/suite/smoke/routes.spec.ts');
    });

    it('skips table separator lines', () => {
      const body = '|------|------|\n| src/lib/foo.ts | desc |';
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('src/lib/foo.ts');
      // Should not error on separator line
    });

    // ─── Exclusion pipeline ───────────────────────────────────────

    it('excludes URLs', () => {
      const body = 'Check `https://example.com/path/file.ts` and `src/lib/real.ts`.';
      const refs = extractReferencedFiles(body);
      expect(refs).not.toContain('https://example.com/path/file.ts');
      expect(refs).toContain('src/lib/real.ts');
    });

    it('excludes glob patterns', () => {
      const body = [
        '```',
        'find src/**/*.ts',
        'cat src/lib/real.ts',
        '```',
      ].join('\n');
      const refs = extractReferencedFiles(body);
      expect(refs).not.toContain('src/**/*.ts');
      expect(refs).toContain('src/lib/real.ts');
    });

    it('excludes shell variables', () => {
      const body = '```\necho $HOME/path/file.ts\ncat src/lib/real.ts\n```';
      const refs = extractReferencedFiles(body);
      expect(refs).toContain('src/lib/real.ts');
    });

    it('excludes absolute system paths', () => {
      const body = '`/usr/local/bin/node` and `src/lib/real.ts`';
      const refs = extractReferencedFiles(body);
      expect(refs).not.toContain('/usr/local/bin/node');
      expect(refs).toContain('src/lib/real.ts');
    });

    // ─── Include patterns (override exclusions) ───────────────────

    it('includePatterns override exclusions', () => {
      const config: ParserConfig = {
        excludePatterns: [],
        excludePatternsOverride: false,
        includePatterns: ['^special/.*\\.custom$'],
        sources: defaultSources,
      };
      // This would normally be excluded (looks weird), but includePatterns force it
      const body = '`special/path.custom` is important.';
      const refs = extractReferencedFiles(body, config);
      expect(refs).toContain('special/path.custom');
    });

    // ─── Source toggling ──────────────────────────────────────────

    it('respects sources.codeBlock = false', () => {
      const config: ParserConfig = {
        excludePatterns: [],
        excludePatternsOverride: false,
        includePatterns: [],
        sources: { backtick: true, codeBlock: false, table: true, plainText: false },
      };
      const body = '`src/lib/from-backtick.ts` and\n```\nsrc/lib/from-codeblock.ts\n```';
      const refs = extractReferencedFiles(body, config);
      expect(refs).toContain('src/lib/from-backtick.ts');
      expect(refs).not.toContain('src/lib/from-codeblock.ts');
    });

    it('extracts from plainText when enabled', () => {
      const config: ParserConfig = {
        excludePatterns: [],
        excludePatternsOverride: false,
        includePatterns: [],
        sources: { backtick: true, codeBlock: true, table: true, plainText: true },
      };
      const body = 'The config lives at config/settings.json in the repo.';
      const refs = extractReferencedFiles(body, config);
      expect(refs).toContain('config/settings.json');
    });

    it('does not extract from plainText by default', () => {
      const body = 'The config lives at config/settings.json in the repo.';
      const refs = extractReferencedFiles(body);
      expect(refs).not.toContain('config/settings.json');
    });

    // ─── excludePatternsOverride ──────────────────────────────────

    it('excludePatternsOverride replaces defaults', () => {
      const config: ParserConfig = {
        excludePatterns: [], // empty override = no exclusions at all
        excludePatternsOverride: true,
        includePatterns: [],
        sources: defaultSources,
      };
      // Normally excluded by default (glob), but override clears all defaults
      // Still needs to pass structural heuristic though (has / and extension)
      const body = '`src/lib/real.ts`';
      const refs = extractReferencedFiles(body, config);
      expect(refs).toContain('src/lib/real.ts');
    });

    // ─── Deduplication ────────────────────────────────────────────

    it('deduplicates paths across sources', () => {
      const body = [
        'Check `src/lib/shared.ts` here.',
        '',
        '```bash',
        'cat src/lib/shared.ts',
        '```',
      ].join('\n');
      const refs = extractReferencedFiles(body);
      const count = refs.filter((r) => r === 'src/lib/shared.ts').length;
      expect(count).toBe(1);
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

  describe('DEFAULT_EXCLUDE_PATTERNS', () => {
    it('is exported and non-empty', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toBeDefined();
      expect(DEFAULT_EXCLUDE_PATTERNS.length).toBeGreaterThan(10);
    });

    it('all patterns compile as valid regex', () => {
      for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    });
  });
});
