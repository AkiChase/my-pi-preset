#!/usr/bin/env python3
"""Three-case targeted fullscreen CLI regression; no models/network/child agents."""
import pathlib,tempfile,subprocess,os,json,time,shlex,shutil,re,sys
R=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
D=R/'.trellis/tasks/10-13-beautify-tool-shell-collapse/research'
O=D/('terminal-fix-'+(sys.argv[1] if len(sys.argv)>1 else 'probe'));O.mkdir(exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='beautify-final-'));server=root.name
for name in ['home','agent','sessions','cwd','logs']:(root/name).mkdir()
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True}))
(root/'agent/process-tasks.json').write_text(json.dumps({'logDir':str(root/'logs')}))
(root/'cwd/sample.ts').write_text('\n'.join(f'export const MARK_{i} = "sample value {i}";' for i in range(1,49))+'\n')
(root/'work.py').write_text('import pathlib,os,select,time\nr=pathlib.Path(__file__).parent\n(r/"pending.pid").write_text(str(os.getpid()))\nprint("PENDING_READY",flush=True)\nend=time.monotonic()+20\nwhile not (r/"pending.release").exists() and time.monotonic()<end:select.select([],[],[],0.05)\nprint("PENDING_FINAL",flush=True)\n')
env={'HOME':str(root/'home'),'PI_CODING_AGENT_DIR':str(root/'agent'),'BEAUTIFY_SMOKE_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PI_TRUE_COLOR':'1','PI_IMAGE_PROTOCOL':'none','PI_HYPERLINKS':'0','PI_TUI_WRITE_LOG':str(root/'terminal.raw'),'PATH':'/Users/jyxc-dz-0101322/.pi/agent/bin:/opt/homebrew/bin:/usr/bin:/bin','TERM':'tmux-256color','COLORTERM':'truecolor','LANG':'en_US.UTF-8','TMPDIR':str(root)}
args=['/opt/homebrew/bin/node','/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tui-mode','fullscreen','--tools','read,bash,find,grep,Agent,get_subagent_result,jobs','-e',str(D/'tmux-harness/provider.ts'),'-e',str(R/'extensions/beautify.ts'),'-e',str(R/'extensions/task-composition.ts'),'--model','beautify-offline/scripted']
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+' '.join(map(shlex.quote,args))
(root/'tmux.conf').write_text('set -g status off\nset -g remain-on-exit on\nset -g extended-keys on\nset -g extended-keys-format csi-u\nset -g exit-empty off\n')
started=time.monotonic()
report={'versions':{'pi':'1.2.0','tmux':'3.6a'},'command':cmd,'server':server,'root':str(root),'cases':[],'error':None,'cleanup':{}}
def tm(*a):return subprocess.run(['/opt/homebrew/bin/tmux','-L',server,'-f',str(root/'tmux.conf'),*a],capture_output=True,check=True).stdout.decode()
def screen():return tm('capture-pane','-p','-t','check:0.0')
def wait(f,label,n=10):
 deadline=time.monotonic()+n
 while time.monotonic()<deadline:
  v=f()
  if v:return v
 raise RuntimeError('Timeout '+label)
def events():
 try:return [json.loads(s) for s in (root/'events.jsonl').read_text().splitlines()]
 except (FileNotFoundError,json.JSONDecodeError):return []
def rendered_width(width,offset):
 try:s=(root/'terminal.raw').read_text()[offset:]
 except FileNotFoundError:return False
 # A cropped tmux border is NOT proof that CLI observed SIGWINCH. Require a
 # complete emitted synchronized frame with exactly the new border width.
 return any(re.search(r'(?<!─)─{'+str(width)+r'}(?!─)',f) for f in s.split('\x1b[?2026l')[:-1])
def backgrounds(ansi):
 bg='default';rows=[]
 for line in ansi.splitlines():
  cells=[]
  for part in re.split(r'(\x1b\[[0-9;]*m)',line):
   if not part.startswith('\x1b['):cells += [bg]*len(part);continue
   codes=list(map(int,part[2:-1].split(';')));i=0
   while i<len(codes):
    c=codes[i]
    if c in [0,49]:bg='default'
    elif c in [38,48]:
     n=4 if codes[i+1]==2 else 2
     if c==48:bg=tuple(codes[i+2:i+n+1])
     i+=n
    elif 40<=c<=47:bg=c
    i+=1
  rows.append(cells+[bg]*max(0,140-len(cells)))
 return rows
def check_bg(label,token,expected):
 ansi=(O/(label+'.ansi.txt')).read_text();text=(O/(label+'.txt')).read_text().splitlines()
 index=next(i for i,r in enumerate(text) if token in r and 'CASE' not in r)
 allcells=backgrounds(ansi);cells=allcells[index]
 nonblank=[i for i,row in enumerate(text) if row.strip() and expected in allcells[i]]
 ok=len(cells)==140 and all(c==expected for c in cells) and nonblank==[index]
 record(label+' effective background','PASS' if ok else 'FAIL',line=text[index],expected=expected,nonblank_rows=nonblank,bad_columns=[i for i,c in enumerate(cells) if c!=expected])
 if not ok:raise RuntimeError('Background discontinuity '+label)
def new_session():
 n=len(events());send('/new')
 wait(lambda:any(e['kind']=='session-start' for e in events()[n:]),'new session event')
 wait(lambda:'SMOKE_READY' in screen(),'new ready')
def send(s):tm('send-keys','-l','-t','check:0.0',s);tm('send-keys','-t','check:0.0','Enter')
def capture(n):
 txt=screen();(O/(n+'.txt')).write_text(txt);(O/(n+'.ansi.txt')).write_text(tm('capture-pane','-p','-e','-t','check:0.0'));return txt
def record(n,s='PASS',**d):report['cases'].append({'case':n,'status':s,**d})
try:
 tm('new-session','-d','-s','check','-x','140','-y','60','-c',str(root/'cwd'),cmd)
 cli_pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').strip());report['cli_pid']=cli_pid
 wait(lambda:'SMOKE_READY' in screen(),'ready',25);capture('startup')
 send('CASE read');wait(lambda:'CASE_DONE read' in screen(),'read done')
 capture('read-140-collapsed')
 for width in [80,40,140]:
  offset=len((root/'terminal.raw').read_text())
  tm('resize-window','-t','check:0','-x',str(width),'-y','60')
  wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_width}').strip()==str(width),'pane width')
  wait(lambda:rendered_width(width,offset),'CLI new-width frame')
  tm('send-keys','-t','check:0.0','C-o');wait(lambda:'MARK_42' in screen(),'read expanded')
  capture('read-'+str(width)+'-expanded')
  tm('send-keys','-t','check:0.0','C-o');wait(lambda:'MARK_42' not in screen(),'read recollapsed')
  txt=capture('read-'+str(width)+'-collapsed')
  line=next(r for r in txt.splitlines() if ':3' in r and 'CASE' not in r)
  hintok='ctrl' not in line or 'ctrl+o expand' in line
  record('hint '+str(width),'PASS' if hintok else 'FAIL',line=line)
 for name in ['bash','read-error']:
  new_session()
  send('CASE '+name);wait(lambda:'CASE_DONE '+name in screen(),'done '+name)
  capture(name+'-140-collapsed')
  check_bg(name+'-140-collapsed','$ python3' if name=='bash' else 'error:',(37,65,49) if name=='bash' else (91,40,42))
  tm('send-keys','-t','check:0.0','C-o')
  wait(lambda:'BASH_LINE_29' in screen() if name=='bash' else any(r.lstrip().startswith('ENOENT:') for r in screen().splitlines()),'expanded '+name)
  capture(name+'-140-expanded')
  tm('send-keys','-t','check:0.0','C-o')
  wait(lambda:'BASH_LINE_29' not in screen() if name=='bash' else not any(r.lstrip().startswith('ENOENT:') for r in screen().splitlines()),'recollapsed '+name)
  capture(name+'-140-recollapsed');record(name+' CtrlO roundtrip')
  check_bg(name+'-140-recollapsed','$ python3' if name=='bash' else 'error:',(37,65,49) if name=='bash' else (91,40,42))
 send('/debug');wait(lambda:(root/'agent/pi-debug.log').exists(),'debug');shutil.copy2(root/'agent/pi-debug.log',O/'host-debug.log')
except Exception as e:
 report['error']=str(e)
 try:capture('failure')
 except Exception:pass
finally:
 try:
  send('/quit');wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').strip()=='1','quit',10);report['cleanup']['natural_cli_exit']=True
 except Exception as e:
  report['cleanup']['natural_cli_exit']=False;report['cleanup']['error']=str(e)
  try:
   pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').strip());os.kill(pid,15)
   wait(lambda:subprocess.run(['/bin/ps','-p',str(pid),'-o','pid='],capture_output=True).returncode!=0,'own CLI terminated',3)
  except Exception:
   try:os.kill(pid,9)
   except (ProcessLookupError,UnboundLocalError):pass
 for p in root.glob('*.pid'):
  pid=int(p.read_text())
  try:os.kill(pid,0);os.kill(pid,15);report['cleanup'][p.name]='TERM owned PID'
  except ProcessLookupError:report['cleanup'][p.name]='gone'
 try:
  wait(lambda:subprocess.run(['/bin/ps','-p',str(cli_pid),'-o','pid='],capture_output=True).returncode!=0,'CLI PID gone',3)
  report['cleanup']['cli_pid_gone']=True
 except Exception as e:
  report['cleanup']['cli_pid_gone']=False;report['error']=report['error'] or str(e)
 try:tm('kill-server');report['cleanup']['own_server_stopped']=True
 except Exception:pass
 for name in ['events.jsonl','terminal.raw','widths.jsonl']:
  p=root/name
  if p.exists():shutil.copy2(p,O/name)
 (O/'sessions').mkdir(exist_ok=True)
 for p in (root/'sessions').glob('*.jsonl'):shutil.copy2(p,O/'sessions'/p.name)
 shutil.rmtree(root);report['cleanup']['isolated_config_removed']=True
 report['elapsed_seconds']=round(time.monotonic()-started,2)
 (O/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

sys.exit(1 if report['error'] or any(c['status']=='FAIL' for c in report['cases']) else 0)
