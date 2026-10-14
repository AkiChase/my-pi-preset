#!/usr/bin/env python3
"""Bounded actual installed CLI + unique tmux; only task research is persistent."""
import argparse, hashlib, json, os, pathlib, re, select, shlex, shutil, subprocess, sys, tempfile, time, traceback
REPO = pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
RESEARCH = REPO / '.trellis/tasks/10-13-at-path-continuation/research'
SDK = pathlib.Path('/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules')
TMUX = '/opt/homebrew/bin/tmux'
NODE = '/opt/homebrew/bin/node'
FD = '/Users/jyxc-dz-0101322/.kimi-code/bin/fd'
parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, choices=[140,80,40], default=140)
parser.add_argument('--full', action='store_true')
parser.add_argument('--attempt', default='minimal')
a = parser.parse_args()
OUT = RESEARCH / 'tmux-harness' / ('evidence-' + a.attempt + '-' + str(a.width))
OUT.mkdir(parents=True, exist_ok=False)
shutil.copyfile(pathlib.Path(__file__), OUT/'driver.py')
shutil.copyfile(RESEARCH/'tmux-harness/probe.ts', OUT/'probe.ts')
root = pathlib.Path(tempfile.mkdtemp(prefix='at-tmux-'))
server = 'at-' + root.name
report = {'status':'RUNNING', 'error':None, 'width':a.width, 'height':40, 'mode':'fullscreen', 'theme':'dark', 'root':str(root), 'server':server, 'cases':[], 'cleanup':{}, 'scope':'Actual installed Pi CLI, native fd provider, real tmux send-keys; public probe observes only.'}
report['product_hashes_before'] = {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [REPO/'extensions/at-path-completion.ts', *sorted((REPO/'extensions/at-path-completion').glob('*.ts'))]}
start = time.monotonic()
pane_pid = None
conf = root / 'tmux.conf'
for d in ['home','agent','cwd','sessions','logs']: (root/d).mkdir()
(root/'cwd/.git').mkdir(); (root/'cwd/.gitignore').write_text('local/\n')
(root/'cwd/local/aa/onlydir').mkdir(parents=True)
(root/'cwd/local/manual').mkdir(); (root/'cwd/local/manual/SLASH_LEAF.txt').write_text('local fixture\n')
(root/'cwd/local/FILE_LEAF.txt').write_text('file fixture\n')
(root/'cwd/space dir').mkdir(); (root/'cwd/space dir/QUOTED_LEAF.txt').write_text('quoted fixture\n')
(root/'cwd/dot').mkdir(); (root/'cwd/dot/DOT_LEAF.txt').write_text('dot fixture\n')
(root/'home/scoped').mkdir(); (root/'home/scoped/HOME_LEAF.txt').write_text('home fixture\n')
(root/'PARENT_LEAF.txt').write_text('parent fixture\n')
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True}))
conf.write_text('set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g status off\nset -g remain-on-exit on\nset -g exit-empty off\nset -g default-terminal tmux-256color\nset -as terminal-features ",*:RGB"\n')
env = {'HOME':str(root/'home'), 'USERPROFILE':str(root/'home'), 'XDG_CONFIG_HOME':str(root/'home/.config'), 'PI_CODING_AGENT_DIR':str(root/'agent'), 'PI_CODING_AGENT_SESSION_DIR':str(root/'sessions'), 'AT_TMUX_ROOT':str(root), 'PI_OFFLINE':'1', 'PI_SKIP_VERSION_CHECK':'1', 'PI_TELEMETRY':'0', 'PI_TRUE_COLOR':'1', 'PI_HYPERLINKS':'0', 'PI_IMAGE_PROTOCOL':'none', 'PI_TUI_WRITE_LOG':str(root/'terminal.raw'), 'PATH':str(pathlib.Path(FD).parent)+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'TERM':'tmux-256color', 'COLORTERM':'truecolor', 'LANG':'en_US.UTF-8', 'TMPDIR':str(root), 'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
cli = [NODE, str(SDK/'@earendil-works/pi-coding-agent/dist/cli.js'), '--offline', '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp', '--session-dir', str(root/'sessions'), '--use-theme', 'dark', '--tui-mode', 'fullscreen', '--tools', 'read', '--extension', str(RESEARCH/'tmux-harness/probe.ts'), '--extension', str(REPO/'extensions/at-path-completion.ts'), '--model', 'at-offline/scripted', '--thinking','off']
cmd = 'exec /usr/bin/env -i ' + ' '.join(shlex.quote(k+'='+v) for k,v in env.items()) + ' ' + shlex.join(cli)
report['command'] = cmd
report['tmux_command'] = shlex.join([TMUX,'-L',server,'-f',str(conf),'new-session','-d','-s','check','-x',str(a.width),'-y','40','-c',str(root/'cwd'),cmd])
report['versions'] = {'pi':'1.2.0','node':subprocess.check_output([NODE,'--version'],text=True).strip(),'tmux':subprocess.check_output([TMUX,'-V'],text=True).strip(),'fd':subprocess.check_output([FD,'--version'],text=True).strip()}
def persist(): (OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
def tm(*args, check=True):
    r = subprocess.run([TMUX,'-L',server,'-f',str(conf),*args],capture_output=True,text=True,timeout=4)
    if check and r.returncode: raise RuntimeError('tmux '+shlex.join(args)+': '+r.stderr)
    return r

def wait(f, label, timeout=6):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        v=f()
        if v:return v
        select.select([],[],[],min(.02,max(0,deadline-time.monotonic())))
    raise RuntimeError('Timeout: '+label)

def events():
    p=root/'events.jsonl'
    if not p.exists(): return []
    return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
def screen(): return tm('capture-pane','-p','-t','check:0.0').stdout

def capture(label):
    txt=screen(); ansi=tm('capture-pane','-p','-e','-t','check:0.0').stdout
    (OUT/(label+'.txt')).write_text(txt); (OUT/(label+'.ansi.txt')).write_text(ansi)
    return txt

def key(k): tm('send-keys','-t','check:0.0',k)
def literal(s): tm('send-keys','-l','-t','check:0.0',s)
def type_chars(s):
    for ch in s:
        n=len(events()); literal(ch)
        wait(lambda:any(e['kind']=='after-input' and e.get('data')==ch for e in events()[n:]),'real input character '+repr(ch))

def observe():
    n=len(events());key('F9')
    return wait(lambda:next((e for e in events()[n:] if e['kind']=='observe'),None),'public F9 observation')

def submits():return len([e for e in events() if e['kind']=='submit'])
def check(label, ok, **data):
    report['cases'].append({'case':label,'status':'PASS' if ok else 'FAIL',**data});persist()
    if not ok:raise AssertionError(label+': '+json.dumps(data,ensure_ascii=False))

def stable_absent(token,label, seconds=.32):
    wait(lambda:token not in screen(),label+' first actual closed paint')
    begin=time.monotonic()
    def done():
        txt=screen()
        if token in txt:raise AssertionError(label+': candidate reappeared')
        return time.monotonic()-begin >= seconds
    wait(done,label,seconds+2)

def clear():
    key('Escape'); key('C-u');check('clear real editor',observe()['text']=='')

def manual(prefix, token, name):
    clear();type_chars(prefix[:-1]);key('Escape')
    wait(lambda:token not in screen(),name+' close before slash')
    check(name+' before slash closed',token not in capture(name+'-before'))
    before=submits();type_chars('/')
    wait(lambda:token in screen(),name+' native candidates after slash')
    text=observe()['text'];capture(name+'-after')
    check(name+' slash without Tab',text==prefix and submits()==before,text=text,expected=prefix,candidate=token,submit_count=submits())

try:
    tm('new-session','-d','-s','check','-x',str(a.width),'-y','40','-c',str(root/'cwd'),cmd)
    pane_pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').stdout.strip())
    ready=wait(lambda:next((e for e in events() if e['kind']=='ready'),None),'CLI session_start',25)
    wait(lambda:'AT_TMUX_READY' in screen(),'actual startup paint')
    capture('startup');check('installed CLI isolated fullscreen startup',ready['pid']==pane_pid and ready['mode']=='tui',ready=ready,pane_pid=pane_pid)
    # Fixed independent sessions: no resize inferred from clipped capture.
    raw=(root/'terminal.raw').read_bytes()
    check('CLI initial frame fixed width',str(a.width)==tm('display-message','-p','-t','check:0.0','#{pane_width}').stdout.strip() and ('─'*a.width).encode() in raw,raw_bytes=len(raw),width=a.width)
    manual('@local/manual/','SLASH_LEAF.txt','ignored-local')
    clear();type_chars('@local/');wait(lambda:'onlydir/' in screen() and 'aa/' in screen(),'native local list')
    before=submits();capture('tab-before');key('Tab')
    wait(lambda:any(e['kind']=='after-input' and e.get('text')=='@local/aa/' for e in events()),'Tab accepts directory')
    wait(lambda:'@local/aa/' in screen() and 'onlydir/' in screen(),'Tab followup candidate')
    capture('tab-after');check('Tab directory continues single directory display',observe()['text']=='@local/aa/' and submits()==before,text=observe()['text'],candidate='onlydir/')
    key('Escape');stable_absent('onlydir/','Escape no rebound');capture('escape-after');check('Escape no rebound',observe()['text']=='@local/aa/' and 'onlydir/' not in screen(),observation_ms=320)
    clear();type_chars('@local/');wait(lambda:'aa/' in screen(),'native list for Enter');before=submits();key('Enter')
    wait(lambda:'@local/aa/' in screen() and 'onlydir/' in screen(),'Enter followup candidate');capture('enter-after')
    check('Enter directory continues and does not submit',observe()['text']=='@local/aa/' and submits()==before,text=observe()['text'],submit_count=submits())
    if a.full:
        manual('@./dot/','DOT_LEAF.txt','dot-relative')
        manual('@../','→ cwd/','parent-relative')
        manual('@~/scoped/','HOME_LEAF.txt','home-relative')
        manual('@'+str(root/'cwd/local/manual')+'/','SLASH_LEAF.txt','absolute')
        manual('@"space dir/','QUOTED_LEAF.txt','quoted')
        # File acceptance and normal submit are real keys, not probe-setText.
        manual('@local/manual/','SLASH_LEAF.txt','file')
        before=submits();key('Enter');wait(lambda:observe()['text']=='@local/manual/SLASH_LEAF.txt ','file accepted with native space')
        stable_absent('→ SLASH_LEAF.txt','file menu closed')
        capture('file-after');check('file acceptance closes with trailing space',observe()['text']=='@local/manual/SLASH_LEAF.txt ' and submits()==before,text=observe()['text'])
        clear();type_chars('ordinary offline message');before=submits();key('Enter')
        wait(lambda:submits()==before+1,'normal real submit');wait(lambda:'OFFLINE_SUBMIT_OK' in screen(),'offline provider response');capture('normal-submit')
        check('normal Enter submits exactly once offline',submits()==before+1 and any(e['kind']=='before-agent-start' for e in events()) and any(e['kind']=='provider-request' for e in events()),submit_count=submits())
        clear();type_chars('@local/aa');wait(lambda:'→ aa/' in screen(),'unique native directory ordinary list');txt=capture('forceTab-before-close')
        check('forceTab native precondition exactly one directory',len([r for r in txt.splitlines() if r.startswith('→ ') or r.startswith('  ') and re.search(r'\S+/',r)])==1 and '(1/' not in txt,captured=txt)
        key('Escape');stable_absent('→ aa/','forceTab precondition list closed');capture('forceTab-before')
        before=submits();n=len(events());key('Tab')
        # Asynchronous explicitTab branch: wait for rendered new directory + child, without injecting an observation key into pending work.
        wait(lambda:'@local/aa/' in screen() and '→ onlydir/' in screen(),'forceTab unique directory followup')
        capture('forceTab-after');text=observe()['text']
        check('forceTab unique directory accepts then only displays child',text=='@local/aa/' and submits()==before,text=text,candidate='onlydir/',native_unique_before='aa/')
        key('Escape');stable_absent('→ onlydir/','forceTab Escape no rebound')
    else:
        report['cases'].append({'case':'extra path/file/submit/forceTab matrix','status':'NOT_RUN','reason':'Smallest first run; --full follows only after fixture review.'})
except Exception as exc:
    report['error']=str(exc);report['traceback']=traceback.format_exc()
    report['cases'].append({'case':'harness or product interruption','status':'FAIL','error':str(exc)})
    try:capture('failure')
    except Exception as capture_exc:report['capture_error']=str(capture_exc)
finally:
    try:
        # Real keys to close candidates and clear draft, then own /quit.
        key('Escape'); key('C-u');literal('/quit');key('Enter')
        wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').stdout.strip()=='1','CLI own quit',8)
        report['cleanup']['natural_cli_exit']=True
        report['cleanup']['pane_dead_status']=tm('display-message','-p','-t','check:0.0','#{pane_dead_status}').stdout.strip()
    except Exception as exc:
        report['cleanup']['natural_cli_exit']=False;report['cleanup']['quit_error']=str(exc)
        if pane_pid:
            try:os.kill(pane_pid,15)
            except ProcessLookupError:pass
    if pane_pid:
        try:
            wait(lambda:subprocess.run(['/bin/ps','-p',str(pane_pid),'-o','pid='],capture_output=True).returncode!=0,'actual CLI PID gone',4)
            report['cleanup']['actual_pid_gone']=True
        except Exception:
            try:os.kill(pane_pid,9)
            except ProcessLookupError:pass
            report['cleanup']['actual_pid_gone']=subprocess.run(['/bin/ps','-p',str(pane_pid),'-o','pid='],capture_output=True).returncode!=0
    tm('kill-server',check=False)
    stopped=tm('list-sessions',check=False)
    report['cleanup']['unique_server_stopped']=stopped.returncode!=0
    report['cleanup']['server_probe']={'returncode':stopped.returncode,'stderr':stopped.stderr.strip()}
    report['cleanup']['cli_pid']=pane_pid
    for name in ['events.jsonl','terminal.raw']:
        p=root/name
        if p.exists():
            # Explicit bounded evidence; oversized logs are a failed harness.
            if p.stat().st_size>2_000_000:report['error']=(report['error'] or '')+' evidence exceeded 2MB: '+name
            shutil.copyfile(p,OUT/name)
    shutil.rmtree(root)
    report['cleanup']['isolated_config_removed']=not root.exists()
    report['elapsed_seconds']=round(time.monotonic()-start,2)
    ok=not report['error'] and all(c['status']!='FAIL' for c in report['cases']) and all(report['cleanup'].get(k) for k in ['natural_cli_exit','actual_pid_gone','unique_server_stopped','isolated_config_removed']) and report['cleanup'].get('pane_dead_status')=='0'
    report['product_hashes_after'] = {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [REPO/'extensions/at-path-completion.ts', *sorted((REPO/'extensions/at-path-completion').glob('*.ts'))]}
    report['product_code_unchanged']=report['product_hashes_before']==report['product_hashes_after']
    report['status']='PASS' if ok else 'FAIL';report['exit_status']=0 if ok else 1;persist()
    print(json.dumps(report,indent=2,ensure_ascii=False));sys.exit(report['exit_status'])
