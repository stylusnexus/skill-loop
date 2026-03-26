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

/**
 * Count commits touching the given paths since a date.
 * Returns 0 if git is unavailable or paths have no history.
 */
export async function countCommitsSince(cwd: string, sinceISO: string, paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const result = await git(cwd, 'rev-list', '--count', `--since=${sinceISO}`, 'HEAD', '--', ...paths);
  if (!result.success) return 0;
  const count = parseInt(result.stdout, 10);
  return Number.isNaN(count) ? 0 : count;
}

/**
 * Get unique parent directories from a list of file paths.
 * Used to detect drift in directories containing referenced files.
 */
export function getParentDirs(filePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const fp of filePaths) {
    const lastSlash = fp.lastIndexOf('/');
    if (lastSlash > 0) {
      dirs.add(fp.slice(0, lastSlash));
    }
  }
  return [...dirs];
}
