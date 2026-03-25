import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

/**
 * Run a git command in the given directory.
 */
async function git(cwd: string, ...args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
  } catch (err: any) {
    return {
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? err.message,
      success: false,
    };
  }
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  return result.stdout;
}

/**
 * Create and checkout a new branch.
 */
export async function createBranch(cwd: string, branchName: string): Promise<GitResult> {
  return git(cwd, 'checkout', '-b', branchName);
}

/**
 * Checkout an existing branch.
 */
export async function checkoutBranch(cwd: string, branchName: string): Promise<GitResult> {
  return git(cwd, 'checkout', branchName);
}

/**
 * Stage a file and commit with a message.
 */
export async function commitFile(cwd: string, filePath: string, message: string): Promise<GitResult> {
  const addResult = await git(cwd, 'add', filePath);
  if (!addResult.success) return addResult;
  return git(cwd, 'commit', '-m', message);
}

/**
 * Revert a specific commit by hash, creating a new commit.
 */
export async function revertCommit(cwd: string, commitHash: string): Promise<GitResult> {
  return git(cwd, 'revert', '--no-edit', commitHash);
}

/**
 * Delete a local branch.
 */
export async function deleteBranch(cwd: string, branchName: string): Promise<GitResult> {
  return git(cwd, 'branch', '-D', branchName);
}

/**
 * Get the latest commit hash on the current branch.
 */
export async function getLatestCommit(cwd: string): Promise<string> {
  const result = await git(cwd, 'rev-parse', 'HEAD');
  return result.stdout;
}

/**
 * Check if the working directory is clean (no uncommitted changes).
 */
export async function isClean(cwd: string): Promise<boolean> {
  const result = await git(cwd, 'status', '--porcelain');
  return result.stdout === '';
}

/**
 * Check if a branch exists locally.
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  const result = await git(cwd, 'rev-parse', '--verify', branchName);
  return result.success;
}

/**
 * Generate a diff between the current state and HEAD for a specific file.
 */
export async function diffFile(cwd: string, filePath: string): Promise<string> {
  const result = await git(cwd, 'diff', 'HEAD', '--', filePath);
  return result.stdout;
}
