import { syncBuiltinESMExports } from 'node:module';
import childProcess, { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, digest, plan, verifyRuntime } from '../lib/initialization/engine.ts';

// Use the real initializer and complete immutable runtime, never bless fake
// scripts with fabricated hashes. Omit only the bootstrap task for count tests.
export function installRuntimeFixture(root, { user = 'Fixture', bootstrap = false } = {}) {
 const result = apply(plan(root, user));
 if (result.state !== 'ready' || !verifyRuntime(root)) throw Error('Runtime fixture did not verify');
 if (!bootstrap) rmSync(join(root, '.trellis/tasks/00-bootstrap-guidelines'), { recursive: true });
}

// Speed: build each initialized project shape once per test process and copy
// it per case. Every case still owns an independent root (and Git repository);
// only the completed initialization record stores the absolute root, and it is
// rewritten exactly as a real initialization at the copy would have written it.
const templates = new Map();
process.on('exit', () => { for (const root of templates.values()) rmSync(root, { recursive: true, force: true }); });
function templateFixture(git, key = '', prepare) {
 const id = `${git}:${key}`;
 let from = templates.get(id);
 if (!from) {
  from = realpathSync(mkdtempSync(join(tmpdir(), 'pi-trellis-template-')));
  templates.set(id, from);
  if (git) execFileSync('git', ['-C', from, 'init', '-q']);
  prepare(from);
 }
 return from;
}
/** `prepare` runs once for the shared build of that shape, so a case-specific project
 * transformation is never repeated per test; only the root-specific record is rewritten. */
export function copyRuntimeFixture(t, { git = false, prepare, key = '', user = 'Fixture' } = {}) {
 const from = templateFixture(git, `${key}:${user}`, prepare ? root => { installRuntimeFixture(root, { user }); prepare(root); } : root => installRuntimeFixture(root, { user }));
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-trellis-fixture-')));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 cpSync(from, root, { recursive: true });
 rehomeOperationRecord(from, root);
 if (!verifyRuntime(root)) throw Error('Copied runtime fixture did not verify');
 return root;
}
/** Point a copied completed initialization record at its new root and re-hash it, exactly as an
 * initialization performed at the copy would have written it. Check rejects a stale plan envelope,
 * so leaving it alone would make unrelated assertions fail for the wrong reason. */
export function rehomeOperationRecord(from, to) {
 const record = join(to, '.trellis/.runtime/init-operation.json');
 const escape = path => JSON.stringify(path).slice(1, -1);
 const operation = JSON.parse(readFileSync(record, 'utf8').replaceAll(escape(from), escape(to)));
 const { planHash, ...body } = operation.plan;
 operation.plan.planHash = digest(JSON.stringify(body));
 writeFileSync(record, JSON.stringify(operation, null, 2) + '\n');
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
