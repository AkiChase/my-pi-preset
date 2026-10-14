#!/usr/bin/env python3
"""Independent bounded post-run evidence/OS cleanup audit; no sessions started."""
import json, pathlib, re, subprocess
HERE=pathlib.Path(__file__).resolve().parent
runs=[]
for directory in sorted(HERE.glob('evidence-*')):
 report=json.loads((directory/'report.json').read_text())
 pid=report['cleanup']['cli_pid']
 ps=subprocess.run(['/bin/ps','-p',str(pid),'-o','pid=,command='],capture_output=True,text=True)
 tmux=subprocess.run(['/opt/homebrew/bin/tmux','-L',report['server'],'-f','/dev/null','list-sessions'],capture_output=True,text=True)
 raw=(directory/'terminal.raw').read_bytes()
 events=[json.loads(x) for x in (directory/'events.jsonl').read_text().splitlines()]
 runs.append({'attempt':directory.name,'status':report['status'],'error':report['error'],'pass_assertions':sum(c['status']=='PASS' for c in report['cases']),'elapsed_seconds':report['elapsed_seconds'],'cli_pid':pid,'ps':{'returncode':ps.returncode,'stdout':ps.stdout.strip()},'server':report['server'],'server_probe':{'returncode':tmux.returncode,'stderr':tmux.stderr.strip()},'root_removed':not pathlib.Path(report['root']).exists(),'cleanup_verified':ps.returncode!=0 and not ps.stdout.strip() and tmux.returncode!=0 and 'no server running' in tmux.stderr and not pathlib.Path(report['root']).exists(),'source_unchanged':report['product_code_unchanged'],'raw_bytes':len(raw),'sync_start':raw.count(b'\x1b[?2026h'),'sync_end':raw.count(b'\x1b[?2026l'),'input_events':sum(e['kind']=='terminal-input' for e in events),'naming_requests':sum(e['kind']=='request' and e.get('naming') for e in events),'visible_failure_capture':(directory/'visible-failure.txt').exists()})
# Only detect likely actual secret assignments; model/request logs contain no credentials/payload.
suspicious=[]
for p in HERE.rglob('*'):
 if p.is_file() and p.suffix in {'.txt','.json','.jsonl','.raw'}:
  for pattern in [rb'Bearer\s+[A-Za-z0-9_.-]{20,}',rb'sk-[A-Za-z0-9]{20,}',rb'"(?:access_token|refresh_token|apiKey)"\s*:\s*"[^"\s]+"']:
   if re.search(pattern,p.read_bytes()):suspicious.append(str(p.relative_to(HERE)))
audit={'status':'PASS' if all(r['cleanup_verified'] and r['source_unchanged'] for r in runs) and not suspicious else 'FAIL','runs':runs,'suspicious_credential_files':suspicious,'evidence_bytes':sum(p.stat().st_size for p in HERE.rglob('*') if p.is_file()),'not_claimed':['physical keyboard/IME','online generation quality','other themes/modes/widths','branch navigation','120-second timeout']}
(HERE/'cleanup-audit.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(audit,indent=2,ensure_ascii=False))
raise SystemExit(0 if audit['status']=='PASS' else 1)
