# Offline PTY integration fixture invoked by install.test.mjs.
import os, pty, subprocess, select, time, struct, fcntl, termios, json, tempfile, pathlib, signal
ROOT = pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='installer-pty-') as temporary:
    box = pathlib.Path(temporary)
    agent = box / 'agent'; agent.mkdir()
    manifest = box / 'preset.json'
    manifest.write_text(json.dumps({'packages': {}, 'settings': {'retry': {'maxRetries': 5}}}))
    pi = box / 'pi'
    pi.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n[ "$1" = list ] && printf "User packages:\\n"\nexit 0\n')
    pi.chmod(0o755)
    env = dict(os.environ, PI_BIN=str(pi), PI_CODING_AGENT_DIR=str(agent), CALLS=str(box/'calls'), NO_COLOR='1')

    def session(cmd, steps, extra=None):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 90, 0, 0))
        def setup():
            os.setsid(); fcntl.ioctl(0, termios.TIOCSCTTY, 0)
        proc_env = {**env, **(extra or {})}
        proc_env.pop('EXPECTED_EXIT', None)
        proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, env=proc_env, preexec_fn=setup)
        os.close(slave); output = bytearray(); pos = 0
        def expect(text):
            nonlocal pos
            deadline = time.monotonic()+10
            while True:
                found = output.find(text.encode(), pos)
                if found >= 0:
                    pos = found+len(text); return
                if time.monotonic() > deadline: raise AssertionError(f'waiting for {text}; exit={proc.poll()} output={output[-500:]}')
                if select.select([master], [], [], 0.2)[0]:
                    try: output.extend(os.read(master, 65536))
                    except OSError: raise AssertionError(f'exited waiting for {text}: {output[-500:]}')
        def send(data): os.write(master, data)
        try:
            steps(expect, send)
            assert proc.wait(timeout=10) == (extra or {}).get('EXPECTED_EXIT', 0)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=4)
            os.close(master)

    def apply(expect, send):
        expect('Choose your preset source'); send(b'\r')
        expect('Choose what to sync'); send(b'a\x1b[B ')
        expect('1 of 5 selected'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('Actual dry-run plan'); assert not (agent/'settings.json').exists()
        send(b'\r'); expect('Setup complete')
    session(['node', str(ROOT/'scripts/install.mjs'), '--manifest', str(manifest)], apply)
    assert json.loads((agent/'settings.json').read_text()) == {'retry': {'maxRetries': 5}}
    (agent/'settings.json').unlink()

    def cancel(expect, send):
        expect('Choose your preset source'); send(b'\r')
        expect('Choose what to sync'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('Actual dry-run plan'); send(b'q'); expect('\x1b[?1049l')
    session(['node', str(ROOT/'scripts/install.mjs'), '--manifest', str(manifest)], cancel)
    assert not (agent/'settings.json').exists()

    def quit_source(expect, send):
        expect('Choose your preset source'); send(b'q'); expect('\x1b[?1049l')
    session(['sh', str(ROOT/'install.sh')], quit_source)

    bin_dir = box/'bin'; bin_dir.mkdir()
    curl = bin_dir/'curl'
    curl.write_text('''#!/bin/sh
for arg in "$@"; do
 case "$arg" in https:*) url="$arg" ;; esac
done
while [ "$#" -gt 0 ]; do
 if [ "$1" = -o ]; then shift; dest="$1"; fi
 shift
done
printf '%s\\n' "$dest" >> "$DOWNLOADS"
case "$url" in
 */pi-preset.json) cp "$FIXTURE_MANIFEST" "$dest" ;;
 */sync.mjs) cp "$SOURCE_ROOT/scripts/sync.mjs" "$dest" ;;
 */install.mjs) cp "$SOURCE_ROOT/scripts/install.mjs" "$dest" ;;
esac
'''); curl.chmod(0o755)
    pipe = box/'piped.sh'; pipe.write_text('printf "%s" "$BOOTSTRAP" | sh\n')
    session(['sh', str(pipe)], quit_source, {
        'BOOTSTRAP': (ROOT/'install.sh').read_text(), 'PATH': str(bin_dir)+':'+env['PATH'],
        'DOWNLOADS': str(box/'downloads'), 'FIXTURE_MANIFEST': str(manifest), 'SOURCE_ROOT': str(ROOT),
    })
    downloads = (box/'downloads').read_text().splitlines()
    assert len(downloads) == 3 and all(not pathlib.Path(p).exists() for p in downloads)
    print('PASS: preview, confirmed write, cancellation, local/piped shell, download cleanup, terminal restore')

    # An applying child must exclusively own stdin, including literal q answers.
    prompt_scripts = box/'prompt'; prompt_scripts.mkdir()
    (prompt_scripts/'install.mjs').write_text((ROOT/'scripts/install.mjs').read_text())
    (prompt_scripts/'sync.mjs').write_text('''
import { createInterface } from "node:readline/promises";
if (process.argv.includes("--dry-run")) console.log("Prompt fixture preview");
else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Child answer: ");
  console.log(`Received: ${answer}`);
  rl.close();
}
''')
    def child_input(expect, send):
        expect('Choose your preset source'); send(b'\r')
        expect('Choose what to sync'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('Actual dry-run plan'); send(b'\r'); expect('Child answer: ')
        send(b'q\r'); expect('Received: q'); expect('Setup complete')
    session(['node', str(prompt_scripts/'install.mjs'), '--manifest', str(manifest)], child_input)
    print('PASS: applying child exclusively receives terminal input')

    checkout = (box/'checkout').resolve(); checkout.mkdir()
    (checkout/'.git').mkdir(); (checkout/'extensions').mkdir(); (checkout/'scripts').mkdir()
    (checkout/'package.json').write_text(json.dumps({'name': 'my-pi-preset', 'pi': {'extensions': ['extensions/*.ts']}}))
    (checkout/'install.sh').write_text('fixture')
    local_manifest = checkout/'pi-preset.json'
    local_manifest.write_text(json.dumps({'packages': {'git:github.com/AkiChase/my-pi-preset': 'latest'}}))
    for filename in ['install.mjs', 'sync.mjs']:
        (checkout/'scripts'/filename).write_text((ROOT/'scripts'/filename).read_text())
    pnpm = bin_dir/'pnpm'
    pnpm.write_text('#!/bin/sh\nprintf "pnpm %s cwd=%s\\n" "$*" "$PWD" >> "$CALLS"\nexit "${PNPM_EXIT:-0}"\n')
    pnpm.chmod(0o755)
    calls = box/'calls'
    def local_apply(expect, send):
        expect('Choose your preset source'); send(b'\x1b[B\r')
        expect('Choose what to sync'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('First: pnpm install'); expect('Actual dry-run plan')
        assert 'pnpm' not in calls.read_text()
        send(b'\r')
        expect('Setup complete')
    calls.write_text('')
    local_env = {'PATH': str(bin_dir)+':'+env['PATH']}
    session(['node', str(checkout/'scripts/install.mjs'), '--manifest', str(local_manifest)], local_apply, local_env)
    recorded = calls.read_text()
    assert f'pnpm install cwd={checkout}' in recorded
    assert recorded.index('pnpm install') < recorded.index('install '+str(checkout))
    calls.write_text('')
    def local_failure(expect, send):
        expect('Choose your preset source'); send(b'\x1b[B\r')
        expect('Choose what to sync'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('Actual dry-run plan'); send(b'\r')
        expect('Pi synchronization was not started')
    session(['node', str(checkout/'scripts/install.mjs'), '--manifest', str(local_manifest)], local_failure, {**local_env, 'PNPM_EXIT': '7', 'EXPECTED_EXIT': 7})
    assert '\ninstall ' not in calls.read_text()
    print('PASS: local pnpm prerequisite is previewed, ordered, and aborts sync on failure')
    calls.write_text('')
    def local_config(expect, send):
        expect('Choose your preset source'); send(b'\x1b[B\r')
        expect('Choose what to sync'); send(b'a\x1b[B ')
        expect('1 of 5 selected'); send(b'\r')
        expect('Choose what to clean up'); send(b'\r')
        expect('Actual dry-run plan'); send(b'\r'); expect('Setup complete')
    session(['node', str(checkout/'scripts/install.mjs'), '--manifest', str(local_manifest)], local_config, local_env)
    assert 'pnpm' not in calls.read_text()
    print('PASS: local config-only selection skips dependency installation')
