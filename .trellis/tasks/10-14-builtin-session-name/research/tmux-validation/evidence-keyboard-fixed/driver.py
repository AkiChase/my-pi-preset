#!/usr/bin/env python3
"""Bounded real keyboard/CLI validation; only this research directory persists."""
import hashlib, json, os, pathlib, select, shlex, shutil, subprocess, sys, tempfile, time, traceback
REPO=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
HERE=pathlib.Path(__file__).resolve().parent
SDK=pathlib.Path('/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules')
NODE='/opt/homebrew/bin/node'; TMUX='/opt/homebrew/bin/tmux'
attempt=sys.argv[1] if len(sys.argv)>1 else 'minimal'
OUT=HERE/('evidence-'+attempt);OUT.mkdir(exist_ok=False)
shutil.copyfile(pathlib.Path(__file__),OUT/'driver.py');shutil.copyfile(HERE/'probe.ts',OUT/'probe.ts')
root=pathlib.Path(tempfile.mkdtemp(prefix='name-tmux-'));server='name-'+root.name
for d in ['home','agent','cwd','sessions','logs']:(root/d).mkdir()
conf=root/'tmux.conf';conf.write_text('set -g status off\nset -g remain-on-exit on\nset -g exit-empty off\nset -g default-terminal tmux-256color\nset -as terminal-features ",*:RGB"\n')
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True,'compaction':{'enabled':False}}))
control={'mode':'ok','title':'Initial Offline Goal','release':False}
(root/'control.json').write_text(json.dumps(control))
files=[REPO/'extensions/session-name.ts',REPO/'extensions/status-bar.ts',*sorted((REPO/'extensions/session-name').glob('*.ts')),*sorted((REPO/'extensions/session-assist').glob('*.ts'))]
def hashes():return {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
report={'status':'RUNNING','error':None,'cases':[],'cleanup':{},'root':str(root),'server':server,'width':140,'height':40,'theme':'dark','mode':'fullscreen','product_hashes_before':hashes()}
pid=None;start=time.monotonic();conf_path=root/'agent/session-name.json'
env={'HOME':str(root/'home'),'USERPROFILE':str(root/'home'),'XDG_CONFIG_HOME':str(root/'home/.config'),'PI_CODING_AGENT_DIR':str(root/'agent'),'PI_CODING_AGENT_SESSION_DIR':str(root/'sessions'),'NAME_TMUX_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PI_TRUE_COLOR':'1','PI_HYPERLINKS':'0','PI_IMAGE_PROTOCOL':'none','PI_TUI_WRITE_LOG':str(root/'terminal.raw'),'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','TERM':'tmux-256color','COLORTERM':'truecolor','LANG':'en_US.UTF-8','TMPDIR':str(root),'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
cli=[NODE,str(SDK/'@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tui-mode','fullscreen','--tools','read','--extension',str(HERE/'probe.ts'),'--extension',str(REPO/'extensions/session-name.ts'),'--extension',str(REPO/'extensions/status-bar.ts'),'--model','name-offline/scripted','--thinking','off']
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+shlex.join(cli)
report['command']=cmd;report['tmux_command']=shlex.join([TMUX,'-L',server,'-f',str(conf),'new-session','-d','-s','check','-x','140','-y','40','-c',str(root/'cwd'),cmd])
report['versions']={'pi':'1.2.0','node':subprocess.check_output([NODE,'--version'],text=True).strip(),'tmux':subprocess.check_output([TMUX,'-V'],text=True).strip()}
def persist():(OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
def tm(*args,check=True):
 r=subprocess.run([TMUX,'-L',server,'-f',str(conf),*args],capture_output=True,text=True,timeout=4)
 if check and r.returncode:raise RuntimeError('tmux '+shlex.join(args)+': '+r.stderr)
 return r
def wait(f,label,timeout=6):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if time.monotonic()-start>500:raise RuntimeError('Total fixture deadline')
  v=f()
  if v:return v
  select.select([],[],[],min(.02,max(0,deadline-time.monotonic())))
 raise RuntimeError('Timeout: '+label)
def events():
 p=root/'events.jsonl'
 return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def count(kind,naming=None):return len([e for e in events() if e['kind']==kind and (naming is None or e.get('naming')==naming)])
def names():return count('request',True)
def screen():return tm('capture-pane','-p','-t','check:0.0').stdout
def capture(label):
 txt=screen();(OUT/(label+'.txt')).write_text(txt);(OUT/(label+'.ansi.txt')).write_text(tm('capture-pane','-p','-e','-t','check:0.0').stdout);return txt
def key(k):
 n=count('after-input');tm('send-keys','-t','check:0.0',k);wait(lambda:count('after-input')>n,'key processed '+k)
def literal(s):
 n=count('after-input');tm('send-keys','-l','-t','check:0.0',s);wait(lambda:count('after-input')>=n+len(s),'literal keyboard text processed')
def send(s):
 literal(s)
 # Slash argument completion owns the first Enter; dismiss via actual Escape before submitting.
 if s.startswith('/'):key('Escape')
 key('Enter')
def ctrl(**kw):
 control.update(kw);tmp=root/'control.tmp';tmp.write_text(json.dumps(control));tmp.replace(root/'control.json')
def observe():
 n=len(events());key('F9')
 return wait(lambda:next((e for e in events()[n:] if e['kind']=='observe'),None),'public observation')
def stable(f,label,seconds=.24):
 begin=time.monotonic()
 def done():
  if not f():raise AssertionError(label)
  return time.monotonic()-begin>=seconds
 wait(done,label,seconds+2)
def record(label,ok=True,**data):
 report['cases'].append({'case':label,'status':'PASS' if ok else 'FAIL',**data});persist()
 if not ok:raise AssertionError(label+': '+json.dumps(data,ensure_ascii=False))
def title_is(t):return observe()['title']==t
def user(s):
 before=count('settled');send(s);wait(lambda:count('settled')>before,'actual user settled '+s)
def expect_title(t,label):
 wait(lambda:t in screen(),label+' actual footer paint');o=observe();capture(label);return o
def open_config():
 send('/session-name config');wait(lambda:'Session naming (automatic' in screen(),'actual select menu')
def disk():return json.loads(conf_path.read_text()) if conf_path.exists() else None
def set_option(down):
 open_config()
 for _ in range(down):key('Down')
 key('Enter')
def saved():wait(lambda:'Session-name configuration saved.' in screen(),'actual config saved notification')
try:
 tm('new-session','-d','-s','check','-x','140','-y','40','-c',str(root/'cwd'),cmd)
 pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').stdout.strip())
 ready=wait(lambda:next((e for e in events() if e['kind']=='ready'),None),'CLI ready',25)
 wait(lambda:'NAME_TMUX_READY' in screen(),'startup paint');capture('startup')
 record('01 isolated installed CLI startup',ready['pid']==pid and ready['mode']=='tui' and b'\xe2\x94\x80'*140 in (root/'terminal.raw').read_bytes(),pid=pid)
 user('Build a local offline session naming validator')
 o=expect_title('Initial Offline Goal','initial-auto')
 record('02 first actual user input creates auto title',names()==1 and o['title']=='Initial Offline Goal',observation=o)
 ctrl(title='Manual Offline Refresh');send('/session-name')
 wait(lambda:'Session name: Manual Offline Refresh' in screen(),'manual success notification');o=expect_title('Manual Offline Refresh','manual-success')
 record('03 manual refresh visible success',names()==2 and o['title']=='Manual Offline Refresh',observation=o)
 open_config();txt=capture('config-defaults');key('Escape');wait(lambda:'Session naming (automatic' not in screen(),'select canceled')
 record('04 config defaults and cancel leaves disk unchanged','automatic on, N=8' in txt and disk() is None,disk=disk())
 set_option(1);saved();capture('config-disabled');record('05 disable persisted',disk()=={'automatic':False,'interval':8},disk=disk())
 before=names();user('Input while automatic naming is disabled');stable(lambda:names()==before,'disabled no request');o=observe();capture('auto-disabled')
 record('06 disabled actual input does not name',o['title']=='Manual Offline Refresh' and names()==before,observation=o)
 set_option(2);wait(lambda:'User inputs between evaluations' in screen(),'actual interval dialog');capture('config-interval-dialog');key('C-u');literal('2');key('Enter');saved();capture('config-interval-saved')
 record('07 set N through real dialog and persist',disk()=={'automatic':False,'interval':2},disk=disk())
 set_option(0);saved();capture('config-enabled');record('08 enable persisted',disk()=={'automatic':True,'interval':2},disk=disk())
 # Manual success creates an unambiguous new baseline after the disabled delivered input.
 ctrl(title='N Round Baseline');send('/session-name');wait(lambda:'Session name: N Round Baseline' in screen(),'manual baseline');expect_title('N Round Baseline','n-baseline');before=names()
 ctrl(title='N Round Updated');user('First N round input');stable(lambda:names()==before,'no early N request');o=observe();capture('n-first-no-early')
 record('09 N first input no early call',names()==before and o['title']=='N Round Baseline',observation=o)
 user('Second N round input');o=expect_title('N Round Updated','n-second-evaluated')
 record('10 N threshold evaluates once',names()==before+1 and o['title']=='N Round Updated',observation=o)
 send('/name Native Protected');expect_title('Native Protected','native-name');before=names()
 user('Protected first user input');user('Protected second user input');stable(lambda:names()==before,'native manual auto protection');o=observe();capture('native-protected-two-inputs')
 record('11 native name protects against automatic evaluation',names()==before and o['title']=='Native Protected',observation=o)
 ctrl(title='Ownership Resumed');send('/session-name');wait(lambda:'Session name: Ownership Resumed' in screen(),'manual resume success');expect_title('Ownership Resumed','ownership-resumed');before=names()
 ctrl(mode='fail');user('Failure threshold first');user('Failure threshold second')
 wait(lambda:'Automatic session naming failed; previous title kept. Will retry after 2 more user inputs.' in screen(),'actual visible failure');o=observe();capture('visible-failure')
 record('12 manual resumes auto; failure visible and preserves title',names()==before+1 and o['title']=='Ownership Resumed',observation=o)
 before=names();stable(lambda:names()==before,'no same-boundary failure busy retry');ctrl(mode='ok',title='Retry After Two Inputs');user('Failure retry first input');stable(lambda:names()==before,'no early failure retry');capture('failure-first-no-retry');user('Failure retry second input');o=expect_title('Retry After Two Inputs','failure-retry-success')
 record('13 failure retries only after N new inputs',names()==before+1 and o['title']=='Retry After Two Inputs',observation=o)
 # Hold automatic response after N inputs; new keyboard input cancels it; release afterwards.
 ctrl(mode='hold',title='Stale Must Never Commit',release=False);before=names();user('Late cancellation first');user('Late cancellation second');wait(lambda:names()==before+1,'held automatic call started');capture('held-auto-request')
 user('New input cancels held naming response');wait(lambda:any(e['kind']=='request-aborted' and e['id']==before+1 for e in events()),'held request signal aborted')
 ctrl(mode='ok',release=True,title='Fresh After Cancellation');wait(lambda:any(e['kind']=='late-provider-return' and e['id']==before+1 for e in events()),'late fixture return');stable(lambda:'Stale Must Never Commit' not in screen(),'stale not visible');o=observe();capture('late-input-canceled')
 record('14 new actual input cancels late response',o['title']!='Stale Must Never Commit' and not any(e['kind']=='title' and e['name']=='Stale Must Never Commit' for e in events()),observation=o)
 # A manual refresh held across native /new uses public replacement command and real keys.
 ctrl(mode='hold',title='Old Session Must Never Commit',release=False);before=names();old=observe()['sessionId'];send('/session-name');wait(lambda:names()==before+1,'held manual call');capture('held-manual-request');send('/new')
 wait(lambda:len([e for e in events() if e['kind']=='ready' and e['sessionId']!=old])>0,'actual native new session',5)
 ctrl(mode='ok',release=True,title='New Session First Title');wait(lambda:any(e['kind']=='late-provider-return' and e['id']==before+1 for e in events()),'late old session return');o=observe();capture('session-replacement-canceled')
 record('15 actual session replacement cancels old response',o['sessionId']!=old and o['title'] is None and not any(e['kind']=='title' and e['name']=='Old Session Must Never Commit' for e in events()),observation=o)
 user('New session observes globally persisted automatic on');o=expect_title('New Session First Title','global-config-new-session');record('16 persisted global config works in new session',o['title']=='New Session First Title' and disk()=={'automatic':True,'interval':2},observation=o)
except Exception as exc:
 report['error']=str(exc);report['traceback']=traceback.format_exc();report['cases'].append({'case':'interruption (fixture/product classification requires review)','status':'FAIL','error':str(exc)})
 try:capture('failure')
 except Exception as ce:report['capture_error']=str(ce)
finally:
 try:
  # Release held fixture resource before own orderly quit; do not touch unrelated PIDs/services.
  ctrl(mode='ok',release=True);key('Escape');key('C-u');send('/quit')
  wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').stdout.strip()=='1','own CLI quit',8)
  report['cleanup']['natural_cli_exit']=True;report['cleanup']['pane_dead_status']=tm('display-message','-p','-t','check:0.0','#{pane_dead_status}').stdout.strip()
 except Exception as exc:
  report['cleanup']['natural_cli_exit']=False;report['cleanup']['quit_error']=str(exc)
  if pid:
   try:os.kill(pid,15)
   except ProcessLookupError:pass
 if pid:
  try:wait(lambda:subprocess.run(['/bin/ps','-p',str(pid),'-o','pid='],capture_output=True).returncode!=0,'actual CLI PID gone',4);report['cleanup']['actual_pid_gone']=True
  except Exception:
   try:os.kill(pid,9)
   except ProcessLookupError:pass
   report['cleanup']['actual_pid_gone']=subprocess.run(['/bin/ps','-p',str(pid),'-o','pid='],capture_output=True).returncode!=0
 tm('kill-server',check=False);p=tm('list-sessions',check=False)
 report['cleanup'].update({'cli_pid':pid,'unique_server_stopped':p.returncode!=0,'server_probe':{'returncode':p.returncode,'stderr':p.stderr.strip()}})
 if conf_path.exists():report['isolated_config_final']=disk()
 # Select metadata only; do not retain config, complete sessions, or provider payloads.
 for name in ['events.jsonl','terminal.raw']:
  p=root/name
  if p.exists():
   if p.stat().st_size>1000000:report['error']=(report['error'] or '')+' evidence exceeded 1MB: '+name
   else:shutil.copyfile(p,OUT/name)
 shutil.rmtree(root);report['cleanup']['isolated_config_removed']=not root.exists();report['elapsed_seconds']=round(time.monotonic()-start,2)
 report['product_hashes_after']=hashes();report['product_code_unchanged']=report['product_hashes_before']==report['product_hashes_after']
 ok=not report['error'] and report['product_code_unchanged'] and all(report['cleanup'].get(k) for k in ['natural_cli_exit','actual_pid_gone','unique_server_stopped','isolated_config_removed']) and report['cleanup'].get('pane_dead_status')=='0'
 report['status']='PASS' if ok else 'FAIL';report['exit_status']=0 if ok else 1
 report['not_run']=['online model quality','physical keyboard/IME','other themes/modes/widths','120-second deadline','branch navigation','concurrent commands/third-party extensions']
 persist();print(json.dumps(report,indent=2,ensure_ascii=False));sys.exit(report['exit_status'])
