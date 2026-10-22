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
        proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, env={**env, **(extra or {})}, preexec_fn=setup)
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
            assert proc.wait(timeout=10) == 0
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
        send(b'\r'); expect('Type APPLY')
        send(b'APPLY\r'); expect('Setup complete')
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
        expect('Actual dry-run plan'); send(b'\r'); expect('Type APPLY')
        send(b'APPLY\r'); expect('Child answer: ')
        send(b'q\r'); expect('Received: q'); expect('Setup complete')
    session(['node', str(prompt_scripts/'install.mjs'), '--manifest', str(manifest)], child_input)
    print('PASS: applying child exclusively receives terminal input')
