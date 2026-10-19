#!/usr/bin/env python3
"""Isolated real-CLI tmux check for hidden background-task reminders (offline scripted provider)."""
import pathlib,tempfile,subprocess,os,json,time,shlex,shutil
R=pathlib.Path('/Users/jyxc-dz-0101322/tools/my-pi-preset')
H=pathlib.Path(__file__).parent; O=pathlib.Path(os.environ.get('REMINDER_EVIDENCE_DIR', tempfile.mkdtemp(prefix='reminder-evidence-'))); O.mkdir(exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='reminder-tmux-')); server=root.name
for n in ['home','agent','sessions','cwd','logs']:(root/n).mkdir()
(root/'agent/settings.json').write_text(json.dumps({'theme':'dark','quietStartup':True,'compaction':{'enabled':False,'keepRecentTokens':1}}))
(root/'agent/process-tasks.json').write_text(json.dumps({'logDir':str(root/'logs')}))
(root/'agent/task-ui.json').write_text(json.dumps({'backgroundReminderInterval':3}))
env={'HOME':str(root/'home'),'PI_CODING_AGENT_DIR':str(root/'agent'),'REMINDER_SMOKE_ROOT':str(root),'PI_OFFLINE':'1','PI_SKIP_VERSION_CHECK':'1','PI_TELEMETRY':'0','PATH':'/Users/jyxc-dz-0101322/.pi/agent/bin:/opt/homebrew/bin:/usr/bin:/bin','TERM':'tmux-256color','LANG':'en_US.UTF-8','TMPDIR':str(root)}
args=['/opt/homebrew/bin/node','/Users/jyxc-dz-0101322/.pi/agent/install/releases/1.3.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-mcp','--session-dir',str(root/'sessions'),'--use-theme','dark','--tools','bash,process_manage','-e',str(H/'provider.ts'),'-e',str(R/'extensions/task-composition.ts'),'--model','reminder-offline/scripted']
cmd='exec /usr/bin/env -i '+' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+' '.join(map(shlex.quote,args))
(root/'tmux.conf').write_text('set -g status off\nset -g remain-on-exit on\nset -g exit-empty off\n')
report={'command':cmd,'server':server,'cases':[],'error':None,'cleanup':{}}
def tm(*a):return subprocess.run(['/opt/homebrew/bin/tmux','-L',server,'-f',str(root/'tmux.conf'),*a],capture_output=True,check=True).stdout.decode()
def screen():return tm('capture-pane','-p','-S','-200','-t','check:0.0')
def wait(f,label,n=20):
 end=time.monotonic()+n
 while time.monotonic()<end:
  v=f()
  if v:return v
  time.sleep(0.05)
 raise RuntimeError('Timeout '+label)
def send(s):tm('send-keys','-l','-t','check:0.0',s);tm('send-keys','-t','check:0.0','Enter')
def requests():
 p=root/'events.jsonl'
 rs=[json.loads(l)['messages'] for l in p.read_text().splitlines() if '"request"' in l] if p.exists() else []
 return [r for r in rs if not any(m['role']=='system' and 'summarization' in m['text'] for m in r)]
def isrem(m):return m['text'].startswith('<background-task-reminder>')
def record(name,ok,**d):report['cases'].append({'case':name,'status':'PASS' if ok else 'FAIL',**d})
try:
 tm('new-session','-d','-s','check','-x','140','-y','50','-c',str(root/'cwd'),cmd)
 wait(lambda:'SMOKE_READY' in screen(),'ready',30)
 send('START BG'); wait(lambda:'DONE START BG' in screen(),'start bg')
 send('LOOP 2'); wait(lambda:'DONE LOOP 2' in screen(),'loop')
 reqs=requests()
 r3=reqs[2]
 record('request 3 (new user run): reminder just before user message', len(reqs)==5 and isrem(r3[-2]) and r3[-1]['text']=='LOOP 2', last=[m['text'][:80] for m in r3[-2:]])
 rem=r3[-2]['text']
 record('reminder lists background shell with name, no command', 'shell | b' in rem and 'long sleeper' in rem and 'tail -f' not in rem, reminder=rem)
 record('requests 1-2,4-5 carry no new reminder', all(sum(isrem(m) for m in reqs[i])==(0 if i<2 else 1) for i in [0,1,3,4]))
 send('/compact'); wait(lambda:'Compacted from' in screen(),'compact',30)
 send('AFTER'); wait(lambda:'DONE AFTER' in screen(),'after')
 reqs=requests()
 after=next(r for r in reversed(reqs) if any(m['text']=='AFTER' for m in r))
 record('after /compact the next request carries a fresh reminder as final message', isrem(after[-1]) and any(m['text']=='AFTER' for m in after), tail=[m['text'][:60] for m in after[-3:]])
 scr=screen(); (O/'screen.txt').write_text(scr)
 record('reminder hidden from the TUI transcript', 'background-task-reminder' not in scr and 'shell | b' not in scr)
except Exception as e:
 report['error']=str(e)
 try:(O/'failure.txt').write_text(screen())
 except Exception:pass
finally:
 try:
  send('/quit'); wait(lambda:tm('display-message','-p','-t','check:0.0','#{pane_dead}').strip()=='1','quit',15); report['cleanup']['natural_cli_exit']=True
 except Exception as e: report['cleanup']['natural_cli_exit']=False; report['cleanup']['error']=str(e)
 ps=subprocess.run(['pgrep','-f','tail -f /dev/null'],capture_output=True,text=True).stdout.split()
 report['cleanup']['tail_remaining']=ps
 try:tm('kill-server');report['cleanup']['own_server_stopped']=True
 except Exception:pass
 if (root/'events.jsonl').exists(): shutil.copy2(root/'events.jsonl',O/'events.jsonl')
 shutil.rmtree(root); report['cleanup']['isolated_root_removed']=True
 (O/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)); print(json.dumps(report,indent=2,ensure_ascii=False))
