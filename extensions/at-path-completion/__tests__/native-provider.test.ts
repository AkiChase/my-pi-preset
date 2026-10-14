import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { it } from 'node:test';
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui';
import { harness, pause } from './harness.ts';

const fd = spawnSync('which', ['fd'], { encoding: 'utf8' }).stdout.trim();
void it('actual native fd provider keeps ignored scoped, dot/parent/absolute/quoted and recursive cap semantics', async t => {
  if (!fd || !existsSync(fd)) { t.skip('Installed fd unavailable; no download attempted'); return; }
  const root = mkdtempSync(join(tmpdir(), 'at-path-native-'));
  const h = harness();
  try {
    mkdirSync(join(root, '.git')); writeFileSync(join(root, '.gitignore'), 'local/\n');
    mkdirSync(join(root, 'local', 'nested'), { recursive: true });
    writeFileSync(join(root, 'local', 'nested', 'leaf.txt'), 'fixture');
    mkdirSync(join(root, 'space dir')); writeFileSync(join(root, 'space dir', 'file.txt'), 'fixture');
    mkdirSync(join(root, 'visible')); writeFileSync(join(root, 'visible', 'visible.txt'), 'fixture');
    mkdirSync(join(root, 'many')); for (let i = 0; i < 30; i++) writeFileSync(join(root, 'many', `${i}.txt`), 'fixture');
    const native = new CombinedAutocompleteProvider([], root, fd);
    h.setSuggestions(native.getSuggestions.bind(native)); h.install(); await h.start();
    for (const prefix of ['@local/', '@./local/', `@${root}/local/`, '@"space dir/']) {
      h.editor.setText(prefix.slice(0, -1)); h.editor.handleInput('/');
      for (let i = 0; i < 100 && !h.editor.isShowingAutocomplete(); i++) await pause(20);
      assert.equal(h.editor.isShowingAutocomplete(), true, prefix);
      const expected = await native.getSuggestions([prefix], 0, prefix.length, { signal: new AbortController().signal });
      assert.ok(expected?.items.length); assert.ok(expected.items.some(item => item.label === (prefix.includes('space') ? 'file.txt' : 'leaf.txt')), 'native recursive descendants retained');
      h.editor.handleInput('\r'); await pause(180);
      assert.ok(h.editor.getText().startsWith('@')); assert.equal(h.counts.submit.length, 0);
    }
    const ignored = await native.getSuggestions(['@local'], 0, 6, { signal: new AbortController().signal });
    assert.equal(ignored, null, 'ignored local is excluded in unscoped search');
    const childProvider = new CombinedAutocompleteProvider([], join(root, 'visible'), fd);
    const parent = await childProvider.getSuggestions(['@../'], 0, 4, { signal: new AbortController().signal }); assert.ok(parent?.items.length);
    const capped = await native.getSuggestions(['@many/'], 0, 6, { signal: new AbortController().signal }); assert.equal(capped?.items.length, 20);
    const quoted = await native.getSuggestions(['@"space dir/'], 0, 12, { signal: new AbortController().signal }); assert.ok(quoted?.items.some(item => item.value === '@"space dir/file.txt"'));
  } finally { await h.close(); rmSync(root, { recursive: true, force: true }); }
});
void it('home path uses native provider in a temporary HOME child, never personal home', async t => {
  if (!fd || !existsSync(fd)) { t.skip('Installed fd unavailable; no download attempted'); return; }
  const home = mkdtempSync(join(tmpdir(), 'at-path-home-'));
  try {
    mkdirSync(join(home, 'scoped')); writeFileSync(join(home, 'scoped', 'leaf.txt'), 'fixture');
    const script = `import assert from 'node:assert/strict'; import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui'; import { homedir } from 'node:os'; assert.equal(homedir(), process.env.HOME); const p = new CombinedAutocompleteProvider([], process.env.HOME, process.env.TEST_FD); const r = await p.getSuggestions(['@~/scoped/'], 0, 10, {signal:new AbortController().signal}); assert.ok(r?.items.some(x => x.value === '@~/scoped/leaf.txt')); console.log('isolated-home-pass');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dirname(dirname(dirname(import.meta.dirname))), env: { ...process.env, HOME: home, USERPROFILE: home, TEST_FD: fd }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /isolated-home-pass/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
void it('fd absent retains native no-result behavior with no replacement search', async () => {
  const h = harness();
  try { const native = new CombinedAutocompleteProvider([], '/tmp', null); h.setSuggestions(native.getSuggestions.bind(native)); h.install(); await h.start();
    h.editor.setText('@local'); h.editor.handleInput('/'); await pause(); assert.equal(h.editor.isShowingAutocomplete(), false);
  } finally { await h.close(); }
});
