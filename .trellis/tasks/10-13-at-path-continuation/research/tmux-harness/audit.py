#!/usr/bin/env python3
"""Final read-only audit of owned PID/server/config and bounded evidence."""
import hashlib, json, pathlib, subprocess, sys
HERE=pathlib.Path(__file__).resolve().parent
summary=json.loads((HERE.parent/'tmux-validation.json').read_text())
audit={'status':'PASS','runs':[], 'credential_files_copied':[], 'evidence_bytes':0, 'oversized_files':[]}
for attempt in summary['attempts']:
    report=json.loads((HERE.parent/attempt['report']).read_text())
    pid=report['cleanup'].get('cli_pid') or next((c['pane_pid'] for c in report['cases'] if 'pane_pid' in c),None)
    ps=subprocess.run(['/bin/ps','-p',str(pid),'-o','pid=,ppid=,command='],capture_output=True,text=True)
    tm=subprocess.run(['/opt/homebrew/bin/tmux','-L',report['server'],'-f','/dev/null','list-sessions'],capture_output=True,text=True)
    result={'attempt':attempt['attempt'],'pid':pid,'ps_returncode':ps.returncode,'ps_stdout':ps.stdout,'unique_server':report['server'],'tmux_returncode':tm.returncode,'tmux_stderr':tm.stderr.strip(),'temporary_root_removed':not pathlib.Path(report['root']).exists()}
    audit['runs'].append(result)
    if ps.returncode==0 or tm.returncode==0 or not result['temporary_root_removed']:audit['status']='FAIL'
for file in HERE.rglob('*'):
    if not file.is_file():continue
    size=file.stat().st_size;audit['evidence_bytes']+=size
    if size>2_000_000:audit['oversized_files'].append(str(file))
    if file.name in ['auth.json','settings.json','models.json','keybindings.json']:audit['credential_files_copied'].append(str(file))
if audit['oversized_files'] or audit['credential_files_copied']:audit['status']='FAIL'
(HERE.parent/'tmux-cleanup-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit,indent=2));sys.exit(0 if audit['status']=='PASS' else 1)
