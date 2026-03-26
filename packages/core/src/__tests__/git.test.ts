import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCurrentBranch,
  createBranch,
  checkoutBranch,
  commitFile,
  isClean,
  branchExists,
  getLatestCommit,
  deleteBranch,
  countCommitsSince,
  getParentDirs,
} from '../git.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

describe('Git Operations', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-loop-git-'));
    // Initialize a git repo with an initial commit
    await exec('git', ['init'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Test');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init'], { cwd: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('gets the current branch name', async () => {
    const branch = await getCurrentBranch(dir);
    // Git default branch could be main or master
    expect(['main', 'master']).toContain(branch);
  });

  it('creates and switches to a new branch', async () => {
    const result = await createBranch(dir, 'skill-loop/test-branch');
    expect(result.success).toBe(true);

    const current = await getCurrentBranch(dir);
    expect(current).toBe('skill-loop/test-branch');
  });

  it('checks out an existing branch', async () => {
    await createBranch(dir, 'feature');
    await checkoutBranch(dir, 'master');
    const fallback = await getCurrentBranch(dir);
    if (fallback !== 'master') {
      // Try main
      await checkoutBranch(dir, 'main');
    }
    await checkoutBranch(dir, 'feature');
    const current = await getCurrentBranch(dir);
    expect(current).toBe('feature');
  });

  it('commits a file', async () => {
    await writeFile(join(dir, 'test.txt'), 'hello');
    const result = await commitFile(dir, 'test.txt', 'add test file');
    expect(result.success).toBe(true);
  });

  it('reports clean working directory', async () => {
    const clean = await isClean(dir);
    expect(clean).toBe(true);

    await writeFile(join(dir, 'dirty.txt'), 'untracked');
    const dirty = await isClean(dir);
    expect(dirty).toBe(false);
  });

  it('checks branch existence', async () => {
    await createBranch(dir, 'exists-branch');
    // Go back to original branch for the check
    const original = (await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).stdout.trim();
    expect(await branchExists(dir, 'exists-branch')).toBe(true);
    expect(await branchExists(dir, 'nonexistent')).toBe(false);
  });

  it('gets the latest commit hash', async () => {
    const hash = await getLatestCommit(dir);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('deletes a branch', async () => {
    const originalBranch = await getCurrentBranch(dir);
    await createBranch(dir, 'to-delete');
    await checkoutBranch(dir, originalBranch);
    const result = await deleteBranch(dir, 'to-delete');
    expect(result.success).toBe(true);
    expect(await branchExists(dir, 'to-delete')).toBe(false);
  });

  it('counts commits since a date for given paths', async () => {
    // Create a subdirectory with commits
    await mkdir(join(dir, 'src', 'lib'), { recursive: true });
    const before = new Date().toISOString();

    await writeFile(join(dir, 'src', 'lib', 'a.ts'), 'export const a = 1;');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'add a'], { cwd: dir });

    await writeFile(join(dir, 'src', 'lib', 'b.ts'), 'export const b = 2;');
    await exec('git', ['add', '.'], { cwd: dir });
    await exec('git', ['commit', '-m', 'add b'], { cwd: dir });

    const count = await countCommitsSince(dir, before, ['src/lib']);
    expect(count).toBe(2);

    // Unrelated path should return 0
    const unrelated = await countCommitsSince(dir, before, ['other/dir']);
    expect(unrelated).toBe(0);
  });

  it('returns 0 for countCommitsSince with empty paths', async () => {
    const count = await countCommitsSince(dir, new Date().toISOString(), []);
    expect(count).toBe(0);
  });
});

describe('getParentDirs', () => {
  it('extracts unique parent directories', () => {
    const dirs = getParentDirs([
      'src/lib/world/layout.ts',
      'src/lib/world/mask.ts',
      'src/lib/map/renderer/zone.ts',
      'src/lib/map/renderer/biome.ts',
      'standalone.ts',
    ]);
    expect(dirs).toContain('src/lib/world');
    expect(dirs).toContain('src/lib/map/renderer');
    expect(dirs).toHaveLength(2); // standalone.ts has no parent dir
  });

  it('returns empty for no paths', () => {
    expect(getParentDirs([])).toEqual([]);
  });
});
