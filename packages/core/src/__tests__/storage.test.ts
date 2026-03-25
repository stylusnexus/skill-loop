import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeJsonAtomic, readJson, appendJsonl, readJsonl } from '../storage.js';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  describe('writeJsonAtomic', () => {
    it('writes valid JSON that can be read back', async () => {
      const path = join(dir, 'test.json');
      const data = { schemaVersion: 1, skills: [] };
      await writeJsonAtomic(path, data);
      const result = await readJson(path);
      expect(result).toEqual(data);
    });

    it('overwrites existing file atomically', async () => {
      const path = join(dir, 'test.json');
      await writeJsonAtomic(path, { v: 1 });
      await writeJsonAtomic(path, { v: 2 });
      const result = await readJson(path);
      expect(result).toEqual({ v: 2 });
    });

    it('does not leave temp files on success', async () => {
      const path = join(dir, 'test.json');
      await writeJsonAtomic(path, { ok: true });
      const files = await readdir(dir);
      expect(files).toEqual(['test.json']);
    });
  });

  describe('readJson', () => {
    it('returns null for non-existent file', async () => {
      const result = await readJson(join(dir, 'missing.json'));
      expect(result).toBeNull();
    });
  });

  describe('appendJsonl', () => {
    it('appends a single record', async () => {
      const path = join(dir, 'runs.jsonl');
      await appendJsonl(path, { id: '1', name: 'test' });
      const lines = await readJsonl(path);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({ id: '1', name: 'test' });
    });

    it('appends multiple records preserving order', async () => {
      const path = join(dir, 'runs.jsonl');
      await appendJsonl(path, { id: '1' });
      await appendJsonl(path, { id: '2' });
      await appendJsonl(path, { id: '3' });
      const lines = await readJsonl(path);
      expect(lines).toHaveLength(3);
      expect(lines.map((l: any) => l.id)).toEqual(['1', '2', '3']);
    });

    it('creates file if it does not exist', async () => {
      const path = join(dir, 'new.jsonl');
      await appendJsonl(path, { id: '1' });
      const lines = await readJsonl(path);
      expect(lines).toHaveLength(1);
    });
  });

  describe('readJsonl', () => {
    it('returns empty array for non-existent file', async () => {
      const result = await readJsonl(join(dir, 'missing.jsonl'));
      expect(result).toEqual([]);
    });

    it('skips blank lines', async () => {
      const path = join(dir, 'test.jsonl');
      await writeFile(path, '{"id":"1"}\n\n{"id":"2"}\n');
      const lines = await readJsonl(path);
      expect(lines).toHaveLength(2);
    });
  });
});
