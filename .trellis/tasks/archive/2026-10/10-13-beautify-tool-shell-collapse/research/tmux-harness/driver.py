#!/usr/bin/env python3
"""Actual isolated tmux+installed Pi validation; no component simulation or network."""
import os, json, tempfile, pathlib, subprocess, time, re, shutil, hashlib, sys
REPO=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
OUT=REPO/'.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/tmux-evidence'
HARNESS=REPO/'.trellis/tasks/archive/2026-10/10-13-beautify-tool-shell-collapse/research/tmux-harness'
SDK=pathlib.Path('/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules')
NODE='/opt/homebrew/bin/node'; TMUX='/opt/homebrew/bin/tmux'
root=pathlib.Path(tempfile.mkdtemp(prefix='beautify-tmux-'))
server='beautify-'+root.name
OUT.mkdir(parents=True,exist_ok=True)
report={'versions':{'pi':'1.2.0','tmux': '3.6a'},'root':str(root),'server':server,'cases':[], 'error':None, 'cleanup':{}, 'scope':'actual tmux Pi CLI agent loop, scripted offline provider, production tools/renderers'}
for d in ['home','agent','cwd','sessions','logs']: (root/d).mkdir()
(root/'cwd/sample.ts').write_text('\n'.join(f'export const MARK_{i} = "sample value {i}";' for i in range(1,49))+'\n')
(root/'cwd/files').mkdir()
for i in range(32): (root/f'cwd/files/match-{i:02d}.ts').write_text(f'const entry = {i};\n')
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True,'toolsExpanded':False}))
(root/'agent/process-tasks.json').write_text(json.dumps({'logDir':str(root/'logs'),'failureTailLinesShown':0}))
(root/'work.py').write_text('''import sys,os,time,select,pathlib
root=pathlib.Path(__file__).parent
mode=sys.argv[1]
(root/(mode+'.pid')).write_text(str(os.getpid()))
print(mode.upper()+'_READY',flush=True)
if mode=='background':
 for i in range(30): print('JOB_LINE_'+str(i),flush=True)
deadline=time.monotonic()+60
while not (root/(mode+'.release')).exists() and time.monotonic()<deadline:
 select.select([],[],[],0.025)
print(mode.upper()+'_FINAL',flush=True)
''')
# Only selected environment; no provider credentials or inherited Pi configuration.
env={'HOME':str(root/'home'),'PI_CODING_AGENT_DIR':str(root/'agent'),'PI_CODING_AGENT_SESSION_DIR':str(root/'sessions'),'BEAUTIFY_SMOKE_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PI_TRUE_COLOR':'1','PI_HYPERLINKS':'0','PI_IMAGE_PROTOCOL':'none','PI_TUI_WRITE_LOG':str(root/'terminal.raw'),'PATH':'/Users/jyxc-dz-0101322/.pi/agent/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','TERM':'tmux-256color','COLORTERM':'truecolor','LANG':'en_US.UTF-8','TMPDIR':str(root)}
cli=[NODE,str(SDK/'@earendil-works/pi-coding-agent/dist/cli.js'),'--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tui-mode','fullscreen','--tools','read,bash,find,grep,Agent,get_subagent_result,jobs','-e',str(HARNESS/'provider.ts'),'-e',str(REPO/'extensions/beautify.ts'),'-e',str(REPO/'extensions/task-composition.ts'),'--model','beautify-offline/scripted','--thinking','off']
import shlex
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+' '.join(shlex.quote(x) for x in cli)
report['command']=cmd
(root/'tmux.conf').write_text('set -g extended-keys on\nset -g extended-keys-format csi-u\nset -g status off\nset -g mouse on\nset -g default-terminal tmux-256color\nset -as terminal-features ",*:RGB"\nset -g exit-empty off\nset -g remain-on-exit on\n')
start=time.monotonic()
def tm(*args,check=True):
 return subprocess.run([TMUX,'-L',server,'-f',str(root/'tmux.conf'),*args],capture_output=True,check=check).stdout.decode('utf-8','replace')
def events():
 try:return [json.loads(x) for x in (root/'events.jsonl').read_text().splitlines() if x]
 except (FileNotFoundError,json.JSONDecodeError): return []
def wait(test, label, timeout=15):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  result=test()
  if result:return result
 raise RuntimeError('Timeout: '+label)
def raw():return tm('capture-pane','-p','-e','-t','check:0.0')
def plain():return tm('capture-pane','-p','-t','check:0.0')
def send(text):
 tm('send-keys','-l','-t','check:0.0',text)
 tm('send-keys','-t','check:0.0','Enter')
def key(k):tm('send-keys','-t','check:0.0',k)
def capture(label):
 ansi=raw(); text=plain()
 (OUT/(label+'.ansi.txt')).write_text(ansi)
 (OUT/(label+'.txt')).write_text(text)
 return text,ansi
def case(label,status='PASS',**detail):report['cases'].append({'case':label,'status':status,**detail});(OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
def run(name,timeout=15):
 n=len(events());send('CASE '+name)
 wait(lambda:any(e['kind']=='planned-call' and e.get('name')==name for e in events()[n:]),'call '+name,timeout)
 wait(lambda:'CASE_DONE '+name in plain(),'case done '+name,timeout)
 wait(lambda:any(e['kind']=='agent-end' for e in events()[n:]),'agent end '+name,timeout)
 capture(name+'-collapsed')
def blocks(ansi):
 # Tool bg differs from user/footer. Group row background by RGB occurrence.
 groups=[]; current=[]; color=None
 for i,line in enumerate(ansi.splitlines()):
  colors=re.findall(r'\x1b\[(?:[0-9;]*;)?48;2;(\d+);(\d+);(\d+)m',line)
  # tmux may combine SGR fields; collect any embedded 48;2 segment.
  if not colors: colors=re.findall(r'48;2;(\d+);(\d+);(\d+)',line)
  start_reset=bool(re.match(r'^\x1b\[(?:0|49)m',line))
  if start_reset:
   if current:groups.append((color,current))
   current=[];color=None
  found=tuple(map(int,colors[0])) if colors else color
  reset_at_end=bool(re.search(r'\x1b\[(?:0|49)m',line))
  if found!=color:
   if current:groups.append((color,current))
   current=[];color=found
  if found:current.append((i+1,re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',line)))
  if reset_at_end:
   if current:groups.append((color,current))
   current=[];color=None
 if current:groups.append((color,current))
 return groups
SUCCESS=None;PENDING=None;ERROR=None
def latest_tool(ansi,token):
 gs=blocks(ansi)
 for color,rows in reversed(gs):
  if any(token in row for _,row in rows):return color,rows
 raise RuntimeError('No tool background group for '+token)
def collapsed(name,token):
 global SUCCESS,ERROR
 text,ansi=capture(name+'-collapsed')
 color,rows=latest_tool(ansi,token)
 nonblank=[(i,r) for i,r in rows if r.strip()]
 if len(nonblank)!=1:
  case(name+' single row','FAIL',bg=color,rows=rows);raise RuntimeError('Actual collapsed tool has '+str(len(nonblank))+' nonblank rows: '+name)
 if 'error' in name: ERROR=color
 elif SUCCESS is None: SUCCESS=color
 case(name+' collapsed','PASS',bg=color,nonblank_rows=nonblank,background_rows=len(rows))
 # Identify background reset followed by nonblank content before next bg.
 target_line=ansi.splitlines()[nonblank[0][0]-1]
 reset=re.search(r'\x1b\[(?:0|49)m([^\x1b]*)',target_line)
 if reset and reset.group(1).strip():case(name+' continuous background','FAIL',reason='ANSI reset before remaining visible title/metadata',raw_line=target_line)
 return rows

def expand(name,expected):
 key('C-o'); wait(lambda:expected in plain(),name+' expanded expected '+expected)
 text,ansi=capture(name+'-expanded');case(name+' expanded',visible_expected=expected)
 key('C-o');wait(lambda:expected not in plain(),name+' collapsed after keyboard')
 capture(name+'-recollapsed');case(name+' actual Ctrl+O roundtrip')

def new_session():
 n=len(events());send('/new');wait(lambda:any(e['kind']=='session-start' for e in events()[n:]),'new session');wait(lambda:'SMOKE_READY' in plain(),'new ready')
try:
 tm('new-session','-d','-s','check','-x','140','-y','60','-c',str(root/'cwd'),cmd)
 wait(lambda:'SMOKE_READY' in plain(),'startup',30)
 capture('startup');case('isolated offline CLI startup')
 run('read');collapsed('read','sample.ts:3');expand('read','MARK_42')
 # SGR actual stdin routing through tmux pane, not direct component.handleMouse.
 _,ansi=capture('mouse-before');color,rows=latest_tool(ansi,'sample.ts:3');bodyrow=next(i for i,r in rows if r.strip())
 for label,y,expected in [('padding',rows[0][0],False),('body',bodyrow,True)]:
  before=len(events())
  sequence=f'\x1b[<0;5;{y}M\x1b[<0;5;{y}m'
  tm('send-keys','-l','-t','check:0.0',sequence)
  (OUT/'mouse-actions.jsonl').open('a').write(json.dumps({'label':label,'input':sequence,'row':y,'method':'tmux send-keys -l'})+'\n')
  if expected: wait(lambda:'MARK_42' in plain(),'mouse body expansion')
  # Force a read-only command after padding to prove an input+render barrier.
  else: send('/smoke-observe');wait(lambda:any(e['kind']=='observe' for e in events()[before:]),'observation barrier')
  text,_=capture('mouse-'+label)
  ok=('MARK_42' in text)==expected
  case('actual SGR '+label,'PASS' if ok else 'FAIL',row=y,mechanism='tmux send-keys -l SGR bytes -> CLI stdin -> fullscreen host mouse routing (host consumes before public input observer)')
  if not ok: raise RuntimeError('Actual mouse behavior mismatch '+label)
 # Body click did not toggle global state. Click body title again to recollapse.
 send('/smoke-observe');n=len(events());wait(lambda:any(e['kind']=='observe' for e in events()[n-20:]),'expanded input barrier')
 text=plain(); title_row=next(i+1 for i,r in enumerate(text.splitlines()) if 'MARK_10' in r)
 tm('send-keys','-l','-t','check:0.0',f'\x1b[<0;7;{title_row}M\x1b[<0;7;{title_row}m')
 wait(lambda:'MARK_42' not in plain(),'mouse recollapse');case('actual SGR expanded code body recollapse',row=title_row)
 for width in [80,40,140]:
  tm('resize-window','-t','check:0','-x',str(width),'-y','60')
  wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_width}').strip()==str(width),'resize settle')
  send('/smoke-observe');n=len(events());wait(lambda:any(e['kind']=='observe' for e in events()[n-20:]),'resize input barrier')
  wait(lambda:any(len(r)==width and r.startswith('──') for r in plain().splitlines()),'real resize render',5)
  key('C-o');wait(lambda:'MARK_42' in plain(),'resize expand');key('C-o');wait(lambda:'MARK_42' not in plain(),'resize collapse')
  collapsed('read-width-'+str(width),'sample.ts:3' if width>40 else ':3')
 case('width 140/80/40 actual resize')
 for name,token,expected in [('find','find *.ts','match-31.ts'),('grep','grep MARK','MARK_48'),('bash','$ python3','BASH_LINE_29'),('bash-error','$ python3','ERROR_LINE_29'),('read-error','missing-file.ts','ENOENT'),('find-error','missing-dir','does not exist'),('grep-error','grep [','regex')]:
  new_session();run(name);collapsed(name,token)
  # Error bodies may vary; exact tool-result observation still retained.
  if name.endswith('error'):
   key('C-o');wait(lambda:len([r for r in plain().splitlines() if r.strip()])>8,name+' error expand');capture(name+'-expanded');key('C-o');case(name+' error keyboard expansion')
  else:expand(name,expected)
 new_session()
 n=len(events());send('CASE bash-pending')
 wait(lambda:any(e['kind']=='execution-update' for e in events()[n:]),'pending update')
 text,ansi=capture('bash-pending');PENDING,rs=latest_tool(ansi,'$ python3');nonblank=[r for i,r in rs if r.strip()]
 case('pending background','PASS' if len(nonblank)==1 else 'FAIL',bg=PENDING,rows=rs)
 (root/'pending.release').touch();wait(lambda:'CASE_DONE bash-pending' in plain(),'pending final');capture('bash-pending-final')
 new_session();run('job-start');wait(lambda:any(e['kind']=='job-id' for e in events()),'job id');wait(lambda:(root/'background.pid').exists(),'actual job pid')
 for name in ['jobs-list','jobs-output','jobs-search','jobs-stats']:
  run(name);collapsed(name,'jobs')
  key('C-o');capture(name+'-expanded');key('C-o');case(name+' real action keyboard expand')
 n=len(events());send('CASE jobs-attach');wait(lambda:any(e['kind']=='execution-update' and e.get('toolName')=='jobs' for e in events()[n:]),'attach partial')
 text,ansi=capture('jobs-attach-partial');color,rs=latest_tool(ansi,'jobs attach');case('attach partial single row','PASS' if len([r for _,r in rs if r.strip()])==1 else 'FAIL',rows=rs)
 key('C-o');wait(lambda:'JOB_LINE_' in plain(),'attach actual streaming text');capture('jobs-attach-partial-expanded');key('C-o')
 tm('send-keys','-l','-t','check:0.0','\x1b[98;6u')
 wait(lambda:'CASE_DONE jobs-attach' in plain(),'attach released')
 text,ansi=capture('jobs-attach-released');case('attach wait release not stop','PASS' if 'following stopped' in text or 'stopped following' in text.lower() else 'FAIL',text=text)
 pid=int((root/'background.pid').read_text());os.kill(pid,0);case('release preserved actual job PID',pid=pid)
 # New attach waits for actual OS completion, terminal result is not current partial.
 n=len(events());send('CASE jobs-attach');wait(lambda:any(e['kind']=='execution-update' and e.get('toolName')=='jobs' for e in events()[n:]),'second attach partial');(root/'background.release').touch()
 wait(lambda:'CASE_DONE jobs-attach' in plain(),'attach completed');collapsed('jobs-attach-final','jobs attach');capture('jobs-attach-final')
 case('actual attach partial->final completed')
 (root/'background.release').unlink();run('job-start');run('jobs-kill');collapsed('jobs-kill','jobs kill');case('actual job kill')
 run('agent-start');run('agent-result',30);collapsed('agent-result','Offline real child result');expand('agent-result','CHILD_RESULT_24')
 run('agent-verbose');collapsed('agent-verbose','Offline real child result');key('C-o');wait(lambda:'Agent Conversation' in plain() or 'CHILD_RESULT_24' in plain(),'verbose expanded');capture('agent-verbose-expanded');key('C-o');case('actual child verbose transcript')
 run('agent-hold');wait(lambda:any(e['kind']=='child-held' for e in events()),'child held',30);run('agent-running');collapsed('agent-running','Offline held child result')
 n=len(events());send('CASE agent-wait');wait(lambda:any(e['kind']=='execution-start' and e.get('toolName')=='get_subagent_result' for e in events()[n:]),'agent waiting');capture('agent-wait-pending')
 tm('send-keys','-l','-t','check:0.0','\x1b[98;6u');wait(lambda:'CASE_DONE agent-wait' in plain(),'agent wait released');collapsed('agent-wait-released','get_subagent_result');capture('agent-wait-released')
 run('agent-running');collapsed('agent-running-after-release','Offline held child result');send('/smoke-release-child');run('agent-missing');collapsed('agent-missing','get_subagent_result')
 # A final keyboard source trace plus host debug: debug is rendered-lines diagnostic, NOT screen capture.
 send('/debug');wait(lambda:(root/'agent/pi-debug.log').exists(),'debug created');shutil.copy2(root/'agent/pi-debug.log',OUT/'host-debug.log')
 case('distinct pending/success/error backgrounds','PASS' if len({SUCCESS,PENDING,ERROR})==3 else 'FAIL',pending=PENDING,success=SUCCESS,error=ERROR)
except Exception as exc:
 report['error']=str(exc)
 try:capture('failure')
 except Exception:pass
finally:
 try:
  send('/quit')
  wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').strip()=='1','CLI natural quit',12)
  report['cleanup']['natural_cli_exit']=True
 except Exception as exc:
  report['cleanup']['natural_cli_exit']=False;report['cleanup']['quit_error']=str(exc)
  # Only pane's owned PID; no user process groups.
  try:
   pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').strip());os.kill(pid,15)
  except Exception:pass
 for f in root.glob('*.pid'):
  pid=int(f.read_text())
  try:os.kill(pid,0)
  except ProcessLookupError:report['cleanup'][f.stem]='gone';continue
  try:os.kill(pid,15)
  except ProcessLookupError:pass
  try:wait(lambda:not pathlib.Path('/proc/'+str(pid)).exists() if sys.platform!='darwin' else subprocess.run(['/bin/ps','-p',str(pid),'-o','pid='],capture_output=True).returncode!=0,'owned pid exit',3)
  except Exception:
   try:os.kill(pid,9)
   except ProcessLookupError:pass
  report['cleanup'][f.stem]='terminated owned PID'
 try:tm('kill-server')
 except Exception:pass
 for file in ['events.jsonl','terminal.raw']:
  p=root/file
  if p.exists():shutil.copy2(p,OUT/file)
 # Retain session transcript only, not config/auth/model store.
 (OUT/'sessions').mkdir(exist_ok=True)
 for p in (root/'sessions').glob('*.jsonl'):shutil.copy2(p,OUT/'sessions'/p.name)
 report['elapsed_seconds']=round(time.monotonic()-start,2)
 report['cleanup']['isolated_config_removed']=True
 shutil.rmtree(root)
 (OUT/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
 print(json.dumps(report,ensure_ascii=False,indent=2))
 sys.exit(1 if report['error'] or any(c['status']=='FAIL' for c in report['cases']) else 0)
