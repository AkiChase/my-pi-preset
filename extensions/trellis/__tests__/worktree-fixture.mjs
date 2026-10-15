// Test adapter only: all lifecycle assertions exercise the native CLI subprocess.
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const runtime = new URL('../runtime/', import.meta.url).pathname;
const cli = join(runtime, 'worktree.py');
/** Copy the native worktree CLI closure into a fixture project's .trellis/scripts (test-only stand-in for initialization). */
export function installWorktreeCli(root) {
  const target = join(root, '.trellis/scripts');
  mkdirSync(join(target, 'pi_trellis_worktree'), { recursive: true });
  cpSync(cli, join(target, 'worktree.py'));
  for (const name of readdirSync(join(runtime, 'pi_trellis_worktree')).filter(name => name.endsWith('.py'))) cpSync(join(runtime, 'pi_trellis_worktree', name), join(target, 'pi_trellis_worktree', name));
}
export async function manageWorktree(request) {
  request.signal?.throwIfAborted();
  const args = [cli, request.action === 'bind' ? 'adopt' : request.action, '--cwd', request.cwd, '--task', request.task, '--json'];
  for (const [key, flag] of [['path', '--path'], ['base', '--base'], ['branch', '--branch'], ['integratedInto', '--integrated-into'], ['role', '--role']]) {
    if (request[key] !== undefined) args.push(flag, request[key]);
  }
  for (const file of request.files ?? []) args.push('--file', file);
  if (request.confirm && request.action !== 'status') args.push('--confirm');
  return new Promise((done, reject) => execFile(process.env.TRELLIS_PYTHON || 'python3', args, {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, signal: request.signal, timeout: 30000,
  }, (error, stdout, stderr) => {
    if (error) { reject(new Error(stderr.trim() || error.message)); return; }
    try { done(JSON.parse(stdout)); } catch (failure) { reject(failure); }
  }));
}
