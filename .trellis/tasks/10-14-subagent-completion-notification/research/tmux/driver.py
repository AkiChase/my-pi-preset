import json, os, pathlib, shlex, subprocess, tempfile, time

REPO = pathlib.Path(__file__).resolve().parents[5]
CLI = pathlib.Path('/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
root = pathlib.Path(tempfile.mkdtemp(prefix='completion-tmux-'))
server = 'completion-' + root.name
report = {'scope': 'real CLI/tmux, scripted offline provider, production agent backend', 'cases': [], 'error': None}
pane = None

def tmux(*args, check=True):
    return subprocess.run(['tmux', '-L', server, *args], text=True, capture_output=True, check=check)
def events():
    p = root / 'events.jsonl'
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []
def wait(predicate):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if predicate(): return
        time.sleep(.05)  # bounded condition polling, not a fixed readiness guess
    raise RuntimeError('condition deadline exceeded')
def send(text):
    tmux('send-keys', '-t', pane, '-l', text)
    tmux('send-keys', '-t', pane, 'Enter')
def capture(name):
    (root / (name + '.screen.txt')).write_text(tmux('capture-pane', '-p', '-t', pane, '-S', '-150').stdout)

try:
    for name in ['home', 'agent', 'cwd', 'sessions']: (root / name).mkdir()
    (root / 'agent/agent-tasks.json').write_text(json.dumps({'schedulingEnabled': False, 'rememberAgents': False, 'outputTranscript': False}))
    env = {'HOME': str(root/'home'), 'PI_CODING_AGENT_DIR': str(root/'agent'), 'COMPLETION_SMOKE_ROOT': str(root),
           'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'TERM': 'tmux-256color', 'LANG': 'en_US.UTF-8',
           'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'PI_TUI_WRITE_LOG': str(root/'terminal.raw')}
    cmd = ['/usr/bin/env', '-i', *[f'{k}={v}' for k,v in env.items()], '/opt/homebrew/bin/node', str(CLI),
           '--offline', '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp',
           '--session-dir', str(root/'sessions'), '--use-theme', 'dark', '--tui-mode', 'fullscreen',
           '-e', str(REPO/'.trellis/tasks/10-14-subagent-completion-notification/research/tmux/provider.ts'),
           '-e', str(REPO/'extensions/task-composition.ts'), '--model', 'completion-offline/scripted', '--thinking', 'off']
    launch = ' '.join(shlex.quote(v) for v in cmd)
    (root/'launch.sh').write_text(launch + '; result=$?; printf "%s" "$result" > '+shlex.quote(str(root/'exit-code'))+'\n')
    pane = tmux('new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'test', '-x', '120', '-y', '40', '-c', str(root/'cwd'), 'bash '+shlex.quote(str(root/'launch.sh'))).stdout.strip()
    wait(lambda: any(e['kind']=='ready' for e in events()))
    capture('ready')
    for label in ['omitted', 'blank']:
        before = len([e for e in events() if e['kind']=='child-completed'])
        send('/completion-spawn' + (' blank' if label=='blank' else ''))
        wait(lambda: len([e for e in events() if e['kind']=='child-completed']) > before)
        wait(lambda: len([e for e in events() if e['kind']=='provider-response' and e['notification']]) > before)
        capture(label)
        record = [e for e in events() if e['kind']=='child-completed'][-1]['value']
        assert record['description'] == 'general-purpose', record
        report['cases'].append({'case':label, 'result':'PASS'})
    send('/completion-spawn invalid')
    wait(lambda: any(e['kind']=='rpc-reply' and e['value'].get('success') is False for e in events()))
    capture('invalid')
    assert len([e for e in events() if e['kind']=='child-completed'])==2
    report['cases'].append({'case':'invalid description refused', 'result':'PASS'})
    send('/completion-mode format-error')
    send('/completion-spawn')
    wait(lambda: 'Subagent completion notification failed' in tmux('capture-pane', '-p', '-t', pane).stdout)
    capture('warning')
    report['cases'].append({'case':'actual UI warning on injected formatter failure', 'result':'PASS'})
    tmux('send-keys', '-t', pane, 'C-d')
    wait(lambda: (root/'exit-code').exists())
    assert (root/'exit-code').read_text()=='0'
    report['cases'].append({'case':'normal CLI exit', 'result':'PASS'})
except Exception as error:
    report['error'] = str(error)
    if pane:
        try: capture('failure')
        except Exception: pass
finally:
    tmux('kill-server', check=False)
    report['root'] = str(root)
    (root/'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    # Keep bounded evidence, remove only owned disposable config/cwd.
    import shutil
    for name in ['home', 'agent', 'cwd']: shutil.rmtree(root/name, ignore_errors=True)
if report['error']: raise SystemExit(1)
