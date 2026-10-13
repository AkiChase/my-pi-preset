#!/usr/bin/env python3
"""One-off real installed Pi CLI validation; writes only research artifacts and temp files.
No model prompts are submitted. Installed sources/dependencies remain read-only.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

RESEARCH = Path(__file__).resolve().parent
WORKTREE = RESEARCH.parents[3]
SDK = Path('/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent')
HISTORY = Path('/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/pi-input-history')
NODE = '/opt/homebrew/bin/node'
CLI = SDK / 'dist/bundle/cli.js'
LATEST = 'CLI history latest beta'
OLDER = 'CLI history older alpha'

OBSERVER = r'''import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
export default function (pi) {
  const write = (data) => appendFileSync(join(getAgentDir(), 'observer.jsonl'), JSON.stringify(data) + '\n');
  const state = (ctx) => ({
    cwd: ctx.cwd, mode: ctx.mode, sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(), editor: ctx.ui.getEditorText(),
    branchUsers: ctx.sessionManager.getBranch().filter(e => e.type === 'message' && e.message.role === 'user').length,
    fffAvailable: globalThis[Symbol.for('pi-pretty.fff-service')]?.service?.isAvailable ?? false,
    fffModuleLoaded: globalThis[Symbol.for('pi-pretty.fff-service')]?.service?.isModuleLoaded() ?? false,
    tools: pi.getAllTools().map(t => t.name),
  });
  pi.on('session_start', (_event, ctx) => write({ type: 'start', ...state(ctx) }));
  pi.on('session_shutdown', (_event, ctx) => write({ type: 'shutdown', ...state(ctx) }));
  pi.on('before_agent_start', () => { write({ type: 'UNEXPECTED_MODEL_PROMPT' }); throw new Error('No model prompts allowed'); });
  pi.registerShortcut('alt+z', { description: 'TEMP read-only editor snapshot', handler: ctx => write({ type: 'snapshot', ...state(ctx) }) });
}
'''

NETWORK_GUARD = r'''const fs = require('node:fs');
function denied(kind) { fs.appendFileSync(process.env.CLI_NETWORK_LOG, kind + '\n'); throw new Error('offline CLI validation forbids network: ' + kind); }
require('node:net').Socket.prototype.connect = function () { return denied('net.connect'); };
require('node:tls').connect = function () { return denied('tls.connect'); };
for (const p of ['node:http', 'node:https']) {
  require(p).request = function () { return denied(p + '.request'); };
  require(p).get = function () { return denied(p + '.get'); };
}
globalThis.fetch = async function () { return denied('fetch'); };
'''

SEED = r'''const { SessionManager } = await import(process.env.CLI_SDK_URL);
const cwd = process.cwd();
const manager = SessionManager.create(cwd);
manager.appendMessage({role:'user', content:'CLI history older alpha', timestamp:Date.now()-2000});
manager.appendMessage({role:'user', content:'CLI history latest beta', timestamp:Date.now()-1000});
const listed = await SessionManager.list(cwd);
if (listed.length !== 1) throw new Error('Expected exactly one seeded previous session');
console.log(JSON.stringify({seedFile:manager.getSessionFile(), seedId:manager.getSessionId(), listed:listed.length}));
'''

ANSI = re.compile(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Z0-9]|[=>])')

def stripped(text):
    return ANSI.sub('', text).replace('\r', '')

def read_jsonl(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

class Driver:
    def __init__(self, cmd, env, cwd, agent):
        self.agent = agent
        self.log = bytearray()
        self.actions = []
        self.fd, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        self.proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env, start_new_session=True)
        os.close(slave)
        self.offset = 0

    def pump(self, timeout=0.05):
        ready, _, _ = select.select([self.fd], [], [], timeout)
        if ready:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                data = b''
            self.log.extend(data)
            if len(self.log) > 2_000_000:
                raise RuntimeError('PTY output exceeded bounded 2MB limit')

    def wait(self, predicate, label, seconds=15):
        deadline = time.monotonic() + seconds
        while not predicate():
            if self.proc.poll() is not None:
                raise RuntimeError(f'CLI exited {self.proc.returncode} while waiting for {label}: {stripped(self.log.decode(errors="replace"))[-3000:]}')
            if time.monotonic() >= deadline:
                raise TimeoutError(f'Timeout waiting for {label}: {stripped(self.log.decode(errors="replace"))[-3000:]}')
            self.pump()
        self.pump(0)

    def send(self, label, data):
        self.actions.append({'action': label, 'bytes': repr(data)})
        os.write(self.fd, data)

    def snapshot(self, label, expected=None):
        previous = len([e for e in read_jsonl(self.agent/'observer.jsonl') if e['type']=='snapshot'])
        self.send(label + ': observer Alt+Z', b'\x1bz')
        self.wait(lambda: len([e for e in read_jsonl(self.agent/'observer.jsonl') if e['type']=='snapshot']) > previous, label)
        entry = [e for e in read_jsonl(self.agent/'observer.jsonl') if e['type']=='snapshot'][-1]
        entry['label'] = label
        if expected is not None and entry['editor'] != expected:
            raise AssertionError(f'{label}: editor {entry["editor"]!r}, expected {expected!r}')
        return entry

    def debug(self, label, token):
        path = self.agent/'pi-debug.log'
        old = path.read_text() if path.exists() else None
        self.send(label + ': global Ctrl+Shift+D', b'\x1b[100;6u')
        self.wait(lambda: path.exists() and path.read_text()!=old, label+' debug')
        text = path.read_text()
        rendered = []
        messages = []
        in_messages = False
        for line in text.splitlines():
            if line == '=== Agent messages (JSONL) ===':
                in_messages = True
            match = re.match(r'^\[\d+\] \(w=\d+\) (.*)$', line)
            if match:
                rendered.append(stripped(json.loads(match.group(1))))
            elif in_messages and line.startswith('{'):
                messages.append(json.loads(line))
        plain = '\n'.join(rendered)
        if token and token not in plain:
            raise AssertionError(f'{label}: token {token!r} absent from actual CLI debug render: {plain[-3000:]}')
        return {'label':label, 'header':text.splitlines()[:3], 'rendered':rendered, 'agentMessageRoles':[m['role'] for m in messages]}

    def capture(self, label, data, tokens):
        start = len(self.log)
        self.send(label, data)
        self.wait(lambda: all(token in stripped(self.log[start:].decode(errors='replace')) for token in tokens), label+' actual PTY display')
        return {'label':label, 'tokens':tokens, 'display':stripped(self.log[start:].decode(errors='replace'))[-6000:]}

    def shutdown(self):
        if self.proc.poll() is None:
            self.send('orderly /quit', b'\x01\x0b/quit\r')
            try:
                self.wait(lambda: self.proc.poll() is not None, 'orderly exit', 5)
            except (TimeoutError, RuntimeError):
                if self.proc.poll() is None:
                    os.killpg(self.proc.pid, signal.SIGTERM)
                    try:
                        self.proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(self.proc.pid, signal.SIGKILL)
                        self.proc.wait(timeout=3)
        self.pump(0)
        os.close(self.fd)


def run_order(order, tui_mode):
    temp = Path(tempfile.mkdtemp(prefix='pi-pretty-cli-')).resolve()
    driver = None
    result = {'order':order, 'tuiMode':tui_mode, 'temporaryRoot':str(temp), 'snapshots':[], 'debug':[], 'display':[], 'pass':False}
    try:
        cwd = temp/'home'
        agent = cwd/'.pi/agent'
        agent.mkdir(parents=True)
        observer = temp/'observer.ts'
        observer.write_text(OBSERVER)
        guard = temp/'network-guard.cjs'
        guard.write_text(NETWORK_GUARD)
        packages = [
            {'source':str(HISTORY), 'extensions':['index.ts'], 'skills':[], 'prompts':[], 'themes':[]},
            {'source':str(WORKTREE), 'extensions':['extensions/bash-unified.ts'], 'skills':[], 'prompts':[], 'themes':[]},
        ]
        if order == 'pretty-first':
            packages.reverse()
        settings = {
            'packages':packages, 'extensions':[str(observer), '-builtin:mcp', '-builtin:llama.cpp', '-builtin:codemode', '-builtin:tool-search'],
            'skills':[], 'prompts':[], 'themes':[], 'defaultProjectTrust':'never',
            'defaultProvider':'offline-validation', 'defaultModel':'never-request', 'defaultThinkingLevel':'off',
            'cacheWarming':'off', 'compaction':{'enabled':False}, 'retry':{'enabled':False},
            'enableInstallTelemetry':False, 'enableAnalytics':False, 'theme':'dark', 'quietStartup':False,
        }
        (agent/'settings.json').write_text(json.dumps(settings, indent=2))
        (agent/'pi-input-history.json').write_text(json.dumps({'searchShortcut':'alt+r'}))
        (agent/'pi-pretty.json').write_text(json.dumps({'fff':{'enableHomeScanning':False,'enableRootScanning':False}}))
        (agent/'models.json').write_text(json.dumps({'providers':{'offline-validation':{'baseUrl':'http://127.0.0.1:9/v1','api':'openai-completions','apiKey':'offline-dummy-not-a-secret','models':[{'id':'never-request','input':['text'],'reasoning':False,'contextWindow':32000,'maxTokens':1000,'cost':{'input':0,'output':0,'cacheRead':0,'cacheWrite':0}}]}}}))
        # A whitelist, never inherit provider auth, Trellis pointers, original cwd, or personal config variables.
        env = {
            'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', 'HOME':str(cwd), 'TMPDIR':str(temp),
            'TERM':'xterm-256color', 'LANG':'en_US.UTF-8', 'LC_ALL':'en_US.UTF-8',
            'PI_CODING_AGENT_DIR':str(agent), 'PRETTY_CONFIG_DIR':str(agent), 'PRETTY_THEME':'github-dark',
            'PRETTY_FFF_HOME_SCAN':'0', 'PRETTY_FFF_ROOT_SCAN':'0',
            'PI_OFFLINE':'1', 'PI_SKIP_VERSION_CHECK':'1', 'PI_TELEMETRY':'0', 'PI_IMAGE_PROTOCOL':'none',
            'BG_TASKS_LOG_DIR':str(temp/'bg'), 'PI_TUI_ESC_TIMEOUT':'100',
            'NODE_OPTIONS':'--require='+str(guard), 'CLI_NETWORK_LOG':str(temp/'network.log'),
            'CLI_SDK_URL':(SDK/'dist/index.js').as_uri(),
        }
        seeded = subprocess.run([NODE,'--input-type=module','-e',SEED], cwd=cwd, env=env, text=True, capture_output=True, timeout=20, check=True)
        result['seed'] = json.loads(seeded.stdout.strip())
        version = subprocess.run([NODE,str(CLI),'--version'],cwd=cwd,env=env,text=True,capture_output=True,timeout=20,check=True)
        result['version'] = version.stdout.strip()
        result['settings'] = settings
        result['environment'] = env
        cmd = [NODE,str(CLI),'--offline','--no-approve','--no-mcp','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--provider','offline-validation','--model','never-request','--tui-mode',tui_mode]
        result['command'] = cmd
        driver = Driver(cmd, env, cwd, agent)
        driver.wait(lambda: any(e['type']=='start' for e in read_jsonl(agent/'observer.jsonl')), 'CLI session_start')
        # session_start is awaited before the CLI binds extension shortcuts.
        driver.wait(lambda: '[Extensions]' in stripped(driver.log.decode(errors='replace')), 'CLI post-bind loaded resources')
        baseline = driver.snapshot('cold-empty','')
        result['snapshots'].append(baseline)
        assert baseline['sessionId'] != result['seed']['seedId'], 'CLI must start fresh, not resume seed'
        assert baseline['branchUsers'] == 0
        assert baseline['fffAvailable'] is False
        assert baseline['tools'].count('bash') == 1, 'Real unified wrapper must own a single bash'
        for phase in ['cold','new','reload']:
            if phase != 'cold':
                prior_starts = sum(e['type']=='start' for e in read_jsonl(agent/'observer.jsonl'))
                old_session = result['snapshots'][-1]['sessionId']
                command = '/new' if phase == 'new' else '/reload'
                output_start = len(driver.log)
                driver.send(command,b'\x01\x0b'+command.encode()+b'\r')
                driver.wait(lambda: sum(e['type']=='start' for e in read_jsonl(agent/'observer.jsonl'))>prior_starts, command+' fresh runner start',30)
                # session_start precedes async FFF initialization and host shortcut binding.
                # Use the CLI completion message, not the early observer event, for reload readiness.
                if phase == 'reload':
                    driver.wait(lambda: 'Reloaded keybindings, extensions, skills, prompts, themes, and context files' in stripped(driver.log[output_start:].decode(errors='replace')), '/reload host completion',30)
                now = driver.snapshot(phase+'-empty','')
                result['snapshots'].append(now)
                if phase == 'new':
                    assert now['sessionId'] != old_session, '/new must replace actual session'
                else:
                    assert now['sessionId'] == old_session, '/reload must retain actual session'
            for label, key, expected in [('up-latest',b'\x1b[A',LATEST),('up-older',b'\x1b[A',OLDER),('down-latest',b'\x1b[B',LATEST),('down-empty',b'\x1b[B','')]:
                driver.send(phase+' '+label,key)
                result['snapshots'].append(driver.snapshot(phase+'-'+label,expected))
                if label == 'up-latest':
                    debug = driver.debug(phase+'-up-latest',LATEST)
                    assert any('❯' in line and LATEST in line for line in debug['rendered']), 'History must appear in decorated Pretty prompt, not transcript'
                    assert debug['agentMessageRoles'] == [], 'No prompt was submitted to model'
                    result['debug'].append(debug)
            result['display'].append(driver.capture(phase+' Alt+R real reverse-search',b'\x1br',['(reverse-search)',LATEST]))
            # Core /debug renders base components only, not overlays. Overlay evidence is actual PTY ANSI output.
            result['debug'].append(driver.debug(phase+'-search-base-debug',None))
            result['display'].append(driver.capture(phase+' fuzzy query',b'ol al',[OLDER,'[1/1]']))
            driver.send(phase+' search accept (not model submit)',b'\r')
            result['snapshots'].append(driver.snapshot(phase+'-search-accepted',OLDER))
            driver.send(phase+' clear for draft',b'\x01\x0bCLI unsent draft')
            result['snapshots'].append(driver.snapshot(phase+'-draft','CLI unsent draft'))
            result['display'].append(driver.capture(phase+' search cancel setup',b'\x1br',['(reverse-search)']))
            driver.send(phase+' Esc search cancel (CSI-u)',b'\x1b[27u')
            result['snapshots'].append(driver.snapshot(phase+'-cancel-preserves-draft','CLI unsent draft'))
            driver.send(phase+' clear draft',b'\x01\x0b')
            result['snapshots'].append(driver.snapshot(phase+'-done-empty',''))
        result['events'] = read_jsonl(agent/'observer.jsonl')
        assert not any(e['type']=='UNEXPECTED_MODEL_PROMPT' for e in result['events'])
        assert not (temp/'network.log').exists(), 'Network guard observed unexpected request'
        result['pass'] = True
    except Exception as error:
        result['error'] = f'{type(error).__name__}: {error}'
    finally:
        if driver:
            driver.shutdown()
            result['actions'] = driver.actions
            result['exitCode'] = driver.proc.returncode
            result['ptyBytes'] = len(driver.log)
            result['ptyTail'] = stripped(driver.log.decode(errors='replace'))[-12000:]
            if 'agent' in locals():
                result['events'] = read_jsonl(agent/'observer.jsonl')
        result['networkAttempts'] = (temp/'network.log').read_text().splitlines() if (temp/'network.log').exists() else []
        shutil.rmtree(temp)
        result['temporaryTreeRemoved'] = not temp.exists()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--order', choices=['both','history-first','pretty-first'], default='both')
    parser.add_argument('--tui-mode', choices=['regular','fullscreen'],default='regular')
    args = parser.parse_args()
    orders = ['history-first','pretty-first'] if args.order=='both' else [args.order]
    results = []
    for order in orders:
        result = run_order(order,args.tui_mode)
        results.append(result)
        (RESEARCH/f'cli-{args.tui_mode}-{order}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'order':order,'tuiMode':args.tui_mode,'pass':result['pass'],'snapshots':len(result['snapshots']),'debug':len(result['debug']),'exitCode':result.get('exitCode'),'error':result.get('error'),'networkAttempts':result['networkAttempts'],'temporaryTreeRemoved':result['temporaryTreeRemoved']},ensure_ascii=False),flush=True)
    raise SystemExit(0 if all(r['pass'] for r in results) else 1)

if __name__ == '__main__':
    main()
