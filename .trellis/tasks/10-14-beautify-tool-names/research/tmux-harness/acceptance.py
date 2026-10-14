#!/usr/bin/env python3
"""Isolated real CLI title acceptance; reviewed historical harness adapted locally."""
import pathlib,tempfile,subprocess,os,json,time,shlex,shutil,re,sys
R=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
D=R/'.trellis/tasks/10-14-beautify-tool-names/research'
O=D/('tmux-'+(sys.argv[1] if len(sys.argv)>1 else 'acceptance'));O.mkdir(exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='beautify-names-'));server=root.name
for name in ['home','agent','sessions','cwd','logs']:(root/name).mkdir()
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True}))
(root/'agent/process-tasks.json').write_text(json.dumps({'logDir':str(root/'logs')}))
(root/'cwd/sample.ts').write_text('\n'.join(f'export const MARK_{i} = "sample value {i}";' for i in range(1,49))+'\n')
(root/'cwd/files').mkdir()
for i in range(32):(root/f'cwd/files/match-{i:02d}.ts').write_text('const item = 1;\n')
(root/'work.py').write_text('import pathlib,select,time\nr=pathlib.Path(__file__).parent\nprint("PENDING_READY",flush=True)\nend=time.monotonic()+20\nwhile not (r/"pending.release").exists() and time.monotonic()<end:select.select([],[],[],0.05)\nprint("PENDING_FINAL",flush=True)\n')
env={'HOME':str(root/'home'),'PI_CODING_AGENT_DIR':str(root/'agent'),'BEAUTIFY_SMOKE_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PI_TRUE_COLOR':'1','PI_IMAGE_PROTOCOL':'none','PI_HYPERLINKS':'0','PI_TUI_WRITE_LOG':str(root/'terminal.raw'),'PATH':'/Users/jyxc-dz-0101322/.pi/agent/bin:/opt/homebrew/bin:/usr/bin:/bin','TERM':'tmux-256color','COLORTERM':'truecolor','LANG':'en_US.UTF-8','TMPDIR':str(root)}
args=['/opt/homebrew/bin/node','/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tui-mode','fullscreen','--tools','read,bash,find,grep,get_subagent_result,jobs,ask_user_question','-e',str(D/'tmux-harness/provider.ts'),'-e',str(R/'extensions/beautify.ts'),'-e',str(R/'extensions/task-composition.ts'),'-e','/Users/jyxc-dz-0101322/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question/index.ts','--model','beautify-offline/scripted']
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+' '.join(map(shlex.quote,args))
(root/'tmux.conf').write_text('set -g status off\nset -g remain-on-exit on\nset -g extended-keys on\nset -g extended-keys-format csi-u\nset -g exit-empty off\n')
started=time.monotonic();cli_pid=None
report={'versions':{'pi':'1.2.0','tmux':'3.6a'},'command':cmd,'server':server,'root':str(root),'cases':[],'error':None,'cleanup':{}}
def tm(*a):return subprocess.run(['/opt/homebrew/bin/tmux','-L',server,'-f',str(root/'tmux.conf'),*a],capture_output=True,check=True).stdout.decode()
def screen():return tm('capture-pane','-p','-t','check:0.0')
def wait(f,label,n=15):
 deadline=time.monotonic()+n
 while time.monotonic()<deadline:
  v=f()
  if v:return v
 raise RuntimeError('Timeout '+label)
def events():
 try:return [json.loads(s) for s in (root/'events.jsonl').read_text().splitlines()]
 except (FileNotFoundError,json.JSONDecodeError):return []
def send(s):tm('send-keys','-l','-t','check:0.0',s);tm('send-keys','-t','check:0.0','Enter')
def capture(n):
 txt=screen();(O/(n+'.txt')).write_text(txt);(O/(n+'.ansi.txt')).write_text(tm('capture-pane','-p','-e','-t','check:0.0'));return txt
def record(n,ok=True,**d):
 report['cases'].append({'case':n,'status':'PASS' if ok else 'FAIL',**d})
 if not ok:raise RuntimeError('Failed '+n)
def new_session():
 n=len(events());send('/new');wait(lambda:any(e['kind']=='session-start' for e in events()[n:]),'new session event');wait(lambda:'SMOKE_READY' in screen(),'new ready')
def run(name):send('CASE '+name);wait(lambda:'CASE_DONE '+name in screen(),'done '+name)
def heading(txt,name):return next((r.strip() for r in txt.splitlines() if r.strip().startswith(name) and 'CASE' not in r),None)
def rendered_width(width,offset):
 try:s=(root/'terminal.raw').read_text()[offset:]
 except FileNotFoundError:return False
 return any(re.search(r'(?<!─)─{'+str(width)+r'}(?!─)',f) for f in s.split('\x1b[?2026l')[:-1])
try:
 tm('new-session','-d','-s','check','-x','140','-y','180','-c',str(root/'cwd'),cmd)
 cli_pid=int(tm('display-message','-p','-t','check:0.0','#{pane_pid}').strip());report['cli_pid']=cli_pid
 wait(lambda:'SMOKE_READY' in screen(),'ready',30);capture('startup')
 for case,name,expected in [('read','read','MARK_42'),('find','find','match-31.ts'),('grep','grep','MARK_48'),('bash','bash','BASH_LINE_29'),('read-error','read','ENOENT:'),('jobs-list','jobs','No background jobs'),('agent-missing','get_subagent_result','Agent not found:')]:
  if case!='read':new_session()
  run(case)
  for width in [140,80,40,140]:
   offset=len((root/'terminal.raw').read_text());current=int(tm('display-message','-p','-t','check:0.0','#{pane_width}').strip())
   if current!=width:
    tm('resize-window','-t','check:0','-x',str(width),'-y','180');wait(lambda:rendered_width(width,offset),'CLI full new-width frame')
   txt=capture(f'{case}-{width}-collapsed');line=heading(txt,name)
   record(f'{case} {width} exact identity',bool(line) and not line.startswith(name+'  '+name+' '),line=line)
   if case=='bash' and width==140:record('long bash clipped only details','…' in line,line=line)
   tm('send-keys','-t','check:0.0','C-o');wait(lambda:expected in screen(),'expanded '+case)
   txt=capture(f'{case}-{width}-expanded');record(f'{case} {width} expanded identity',bool(heading(txt,name)),expected=expected)
   tm('send-keys','-t','check:0.0','C-o');wait(lambda:not any(r.lstrip().startswith(expected) for r in screen().splitlines()) if case in ['read-error','agent-missing'] else expected not in screen(),'recollapsed '+case)
   txt=capture(f'{case}-{width}-recollapsed');record(f'{case} {width} Ctrl+O roundtrip',bool(heading(txt,name)))
 new_session();send('CASE bash-pending')
 wait(lambda:any(e['kind']=='execution-update' for e in events()),'pending update')
 wait(lambda:heading(screen(),'bash'),'pending title')
 txt=capture('bash-pending');record('pending exact bash identity',bool(heading(txt,'bash')))
 (root/'pending.release').touch();wait(lambda:'CASE_DONE bash-pending' in screen(),'pending final');capture('bash-pending-final')
 new_session();send('CASE ask-name')
 wait(lambda:'Choose acceptance option?' in screen(),'actual question dialog',25)
 capture('ask-dialog');tm('send-keys','-t','check:0.0','Escape');wait(lambda:'CASE_DONE ask-name' in screen(),'ask cancel')
 txt=capture('ask-cancelled');record('actual ask plugin retains lowercase registered title',bool(heading(txt,'ask_user_question')))
 record('actual ask question opened and cancelled without changing plugin',True)
except Exception as e:
 report['error']=str(e)
 try:capture('failure')
 except Exception:pass
finally:
 try:
  send('/quit');wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').strip()=='1','quit',10);report['cleanup']['natural_cli_exit']=True
 except Exception as e:
  report['cleanup']['natural_cli_exit']=False;report['cleanup']['error']=str(e)
  if cli_pid:
   try:os.kill(cli_pid,15)
   except ProcessLookupError:pass
 if cli_pid:
  try:wait(lambda:subprocess.run(['/bin/ps','-p',str(cli_pid),'-o','pid='],capture_output=True).returncode!=0,'CLI PID gone',3);report['cleanup']['cli_pid_gone']=True
  except Exception as e:report['cleanup']['cli_pid_gone']=False;report['error']=report['error'] or str(e)
 try:tm('kill-server');report['cleanup']['own_server_stopped']=True
 except Exception:pass
 for name in ['events.jsonl','terminal.raw']:
  p=root/name
  if p.exists():shutil.copy2(p,O/name)
 shutil.rmtree(root);report['cleanup']['isolated_config_removed']=True
 report['elapsed_seconds']=round(time.monotonic()-started,2)
 (O/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
sys.exit(1 if report['error'] or any(c['status']=='FAIL' for c in report['cases']) else 0)
