#!/usr/bin/env python3
"""Bounded final smoke for optional jobs and pending color; reuse fixture, actual CLI."""
import pathlib,tempfile,subprocess,os,json,time,shlex,shutil,re
R=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
D=R/'.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research'
O=D/'tmux-minimal';O.mkdir(exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='beautify-final-'));server=root.name
for name in ['home','agent','sessions','cwd','logs']:(root/name).mkdir()
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True}))
(root/'agent/process-tasks.json').write_text(json.dumps({'logDir':str(root/'logs')}))
(root/'work.py').write_text('import pathlib,os,select,time\nr=pathlib.Path(__file__).parent\n(r/"pending.pid").write_text(str(os.getpid()))\nprint("PENDING_READY",flush=True)\nend=time.monotonic()+20\nwhile not (r/"pending.release").exists() and time.monotonic()<end:select.select([],[],[],0.05)\nprint("PENDING_FINAL",flush=True)\n')
env={'HOME':str(root/'home'),'PI_CODING_AGENT_DIR':str(root/'agent'),'BEAUTIFY_SMOKE_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PI_TRUE_COLOR':'1','PI_IMAGE_PROTOCOL':'none','PI_HYPERLINKS':'0','PI_TUI_WRITE_LOG':str(root/'terminal.raw'),'PATH':'/Users/jyxc-dz-0101322/.pi/agent/bin:/opt/homebrew/bin:/usr/bin:/bin','TERM':'tmux-256color','COLORTERM':'truecolor','LANG':'en_US.UTF-8','TMPDIR':str(root)}
args=['/opt/homebrew/bin/node','/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tools','read,bash,find,grep,Agent,get_subagent_result,jobs','-e',str(D/'tmux-harness/provider.ts'),'-e',str(R/'extensions/beautify.ts'),'-e',str(R/'extensions/task-composition.ts'),'--model','beautify-offline/scripted']
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+' '.join(map(shlex.quote,args))
(root/'tmux.conf').write_text('set -g status off\nset -g remain-on-exit on\nset -g extended-keys on\nset -g extended-keys-format csi-u\nset -g exit-empty off\n')
report={'command':cmd,'server':server,'root':str(root),'cases':[],'error':None,'cleanup':{}}
def tm(*a):return subprocess.run(['/opt/homebrew/bin/tmux','-L',server,'-f',str(root/'tmux.conf'),*a],capture_output=True,check=True).stdout.decode()
def screen():return tm('capture-pane','-p','-t','check:0.0')
def wait(f,label,n=10):
 deadline=time.monotonic()+n
 while time.monotonic()<deadline:
  v=f()
  if v:return v
 raise RuntimeError('Timeout '+label)
def send(s):tm('send-keys','-l','-t','check:0.0',s);tm('send-keys','-t','check:0.0','Enter')
def capture(n):
 txt=screen();(O/(n+'.txt')).write_text(txt);(O/(n+'.ansi.txt')).write_text(tm('capture-pane','-p','-e','-t','check:0.0'));return txt
def record(n,s='PASS',**d):report['cases'].append({'case':n,'status':s,**d})
try:
 tm('new-session','-d','-s','check','-x','140','-y','50','-c',str(root/'cwd'),cmd)
 wait(lambda:'SMOKE_READY' in screen(),'ready',25);capture('startup')
 send('CASE jobs-list');wait(lambda:'CASE_DONE jobs-list' in screen(),'jobs list')
 txt=capture('jobs-list-collapsed');line=[r for r in txt.splitlines() if 'jobs list' in r and 'CASE' not in r]
 record('actual jobs list empty collapsed','PASS' if len(line)==1 and '0 jobs' in line[0] else 'FAIL',lines=line)
 tm('send-keys','-t','check:0.0','C-o');wait(lambda:'No background jobs' in screen(),'jobs expanded');capture('jobs-list-expanded');record('actual jobs Ctrl+O expanded',returned_text='No background jobs')
 tm('send-keys','-t','check:0.0','C-o');wait(lambda:'No background jobs' not in screen(),'jobs collapsed again');capture('jobs-list-recollapsed');record('actual jobs Ctrl+O recollapse')
 send('/new');wait(lambda:'New session started' in screen(),'new');send('CASE bash-pending');wait(lambda:(root/'pending.pid').exists(),'OS process started')
 # Execution update->terminal paint is asynchronous; wait on rendered tool title.
 wait(lambda:'$ python3' in screen(),'pending render');capture('pending')
 record('actual pending shell background',pid=int((root/'pending.pid').read_text()))
 (root/'pending.release').touch();wait(lambda:'CASE_DONE bash-pending' in screen(),'pending final');capture('pending-final')
 send('/debug');wait(lambda:(root/'agent/pi-debug.log').exists(),'debug');shutil.copy2(root/'agent/pi-debug.log',O/'host-debug.log')
except Exception as e:
 report['error']=str(e)
 try:capture('failure')
 except Exception:pass
finally:
 try:
  send('/quit');wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').strip()=='1','quit',10);report['cleanup']['natural_cli_exit']=True
 except Exception as e:report['cleanup']['natural_cli_exit']=False;report['cleanup']['error']=str(e)
 for p in root.glob('*.pid'):
  pid=int(p.read_text())
  try:os.kill(pid,0);os.kill(pid,15);report['cleanup'][p.name]='TERM owned PID'
  except ProcessLookupError:report['cleanup'][p.name]='gone'
 try:tm('kill-server');report['cleanup']['own_server_stopped']=True
 except Exception:pass
 for name in ['events.jsonl','terminal.raw']:
  p=root/name
  if p.exists():shutil.copy2(p,O/name)
 (O/'sessions').mkdir(exist_ok=True)
 for p in (root/'sessions').glob('*.jsonl'):shutil.copy2(p,O/'sessions'/p.name)
 shutil.rmtree(root);report['cleanup']['isolated_config_removed']=True
 (O/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
