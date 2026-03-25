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
});
