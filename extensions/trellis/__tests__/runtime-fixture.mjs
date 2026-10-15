import { syncBuiltinESMExports } from 'node:module';
import childProcess, { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, plan, verifyRuntime } from '../lib/initialization/engine.ts';

// Use the real initializer and complete immutable runtime, never bless fake
// scripts with fabricated hashes. Omit only the bootstrap task for count tests.
export function installRuntimeFixture(root) {
 const result = apply(plan(root, 'Fixture'));
 if (result.state !== 'ready' || !verifyRuntime(root)) throw Error('Runtime fixture did not verify');
 rmSync(join(root, '.trellis/tasks/00-bootstrap-guidelines'), { recursive: true });
}

// Speed: build each initialized project shape once per test process and copy
// it per case. Every case still owns an independent root (and Git repository);
// only the completed initialization record stores the absolute root, and it is
// rewritten exactly as a real initialization at the copy would have written it.
const templates = new Map();
process.on('exit', () => { for (const root of templates.values()) rmSync(root, { recursive: true, force: true }); });
export function copyRuntimeFixture(t, { git = false } = {}) {
 const key = String(git);
 let from = templates.get(key);
 if (!from) {
  from = realpathSync(mkdtempSync(join(tmpdir(), 'pi-trellis-template-')));
  templates.set(key, from);
  if (git) execFileSync('git', ['-C', from, 'init', '-q']);
  installRuntimeFixture(from);
 }
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-trellis-fixture-')));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 cpSync(from, root, { recursive: true });
 const record = join(root, '.trellis/.runtime/init-operation.json');
 const escape = path => JSON.stringify(path).slice(1, -1);
 writeFileSync(record, readFileSync(record, 'utf8').replaceAll(escape(from), escape(root)));
 if (!verifyRuntime(root)) throw Error('Copied runtime fixture did not verify');
 return root;
}

// Adversarial CLI replies / spawn failures belong at the host execution
// boundary. Manifest and Python bytes remain genuinely supported throughout.
// One shared execFile router keyed by project root lets concurrent tests mock
// their own roots; calls for any other cwd reach the real execFile.
const responders = new Map();
let original;
export function mockPython(t, root, respond) {
 if (responders.has(root)) throw Error(`execFile already mocked for ${root}`);
 if (!responders.size) {
  original = childProcess.execFile;
  childProcess.execFile = (executable, args, options, callback) => {
   const reply = responders.get(options?.cwd)?.(args, options);
   if (reply === undefined) return original(executable, args, options, callback);
   queueMicrotask(() => callback(reply.code ? Object.assign(Error('Fixture execution failure'), { code: reply.code }) : null, reply.stdout ?? '', ''));
  };
  syncBuiltinESMExports();
 }
 responders.set(root, respond);
 t.after(() => {
  responders.delete(root);
  if (!responders.size) { childProcess.execFile = original; syncBuiltinESMExports(); }
 });
}
