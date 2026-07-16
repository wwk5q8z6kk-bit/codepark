import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function isGitRepo(cwd) {
  const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.stdout.trim() === 'true';
}

export async function gitSummary(cwd) {
  if (!(await isGitRepo(cwd))) return { isRepo: false };
  return {
    isRepo: true,
    branch: (await runGit(cwd, ['branch', '--show-current'])).stdout.trim(),
    status: (await gitStatus(cwd)),
    recent: (await runGit(cwd, ['log', '--oneline', '-5'])).stdout.trim()
  };
}

export async function gitStatus(cwd) {
  if (!(await isGitRepo(cwd))) return 'not a git repository';
  return (await runGit(cwd, ['status', '--short', '--branch'])).stdout.trim();
}

export async function gitDiff(cwd, filePath = '') {
  if (!(await isGitRepo(cwd))) return 'not a git repository';
  const args = filePath ? ['diff', '--', filePath] : ['diff'];
  const diff = (await runGit(cwd, args)).stdout.trim();
  return diff || '[no unstaged diff]';
}

export async function gitDiffStat(cwd) {
  if (!(await isGitRepo(cwd))) return 'not a git repository';
  const diff = (await runGit(cwd, ['diff', '--stat'])).stdout.trim();
  return diff || '[no unstaged diff]';
}

export function formatGitSummary(summary) {
  if (!summary.isRepo) return 'not a git repository';
  return [
    `branch: ${summary.branch || '(detached)'}`,
    '',
    'status:',
    summary.status || '[clean]',
    '',
    'recent:',
    summary.recent || '[no commits]'
  ].join('\n');
}

async function runGit(cwd, args) {
  try {
    return await execFileAsync('git', args, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
  } catch {
    return { stdout: '', stderr: '' };
  }
}
