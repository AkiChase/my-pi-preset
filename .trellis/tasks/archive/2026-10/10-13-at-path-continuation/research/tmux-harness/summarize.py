#!/usr/bin/env python3
"""Read actual evidence and publish bounded machine summary, with nonzero FAIL."""
import json, pathlib, re, sys
HERE=pathlib.Path(__file__).resolve().parent
RESEARCH=HERE.parent
selected=['matrix-visible-140','final-80','final-40']
summary={'status':'FAIL','scope':'Pi 1.2.0 actual installed CLI; dark fullscreen fixed 140/80/40x40; native fd provider; public read-only input/text/submit probe; no private editor calls','runs':[],'attempts':[], 'not_run':['physical terminal/IME/attached client forwarding','actual input-history package, closed-quote cursor position, and arbitrary third-party extensions','regular mode, light/system theme','resize transition (fixed independent sessions instead)','agent/model online matrix and paste/rapid async lifecycle stress; covered only by previous separate offline tests'], 'error':None}
for name in ['first-140','minimal-fixed-140','matrix-140',*selected]:
    p=HERE/('evidence-'+name)/'report.json'
    if not p.exists():
        if name in selected:summary['error']='Missing required report '+name
        continue
    r=json.loads(p.read_text());entry={'attempt':name,'report':str(p.relative_to(RESEARCH)), 'status':r['status'],'error':r.get('error'),'exit_status':r.get('exit_status'),'elapsed_seconds':r.get('elapsed_seconds'),'cleanup':r['cleanup']}
    if name=='first-140':entry['classification']='Fixture paint barrier missing; preserved FAIL, not confirmed product failure'
    if name=='matrix-140':entry['classification']='Fixture expected offscreen native candidate; preserved FAIL, not confirmed product failure'
    summary['attempts'].append(entry)
    if name not in selected:continue
    raw=(p.parent/'terminal.raw').read_bytes()
    events=[json.loads(x) for x in (p.parent/'events.jsonl').read_text().splitlines() if x.strip()]
    seq='─'.encode()*r['width'];index=raw.find(seq)
    records=[e for e in events if e['kind']=='submit']
    entry.update({'width':r['width'],'height':r['height'],'mode':r['mode'],'theme':r['theme'],'command':r['command'],'tmux_command':r['tmux_command'],'cases':r['cases'],'product_hashes_before':r['product_hashes_before'],'product_hashes_after':r['product_hashes_after'],'product_code_unchanged':r['product_code_unchanged'],'files':{f.name:f.stat().st_size for f in sorted(p.parent.iterdir()) if f.is_file()},'raw_frame':{'bytes':len(raw),'initial_full_width_border_offset':index,'synchronized_start_count':raw.count(b'\x1b[?2026h'),'synchronized_end_count':raw.count(b'\x1b[?2026l'),'initial_width_proof':'fixed session from initial CLI launch; whole-width border in actual CLI raw stream, not capture-only clipping'},'events':{'count':len(events),'submit_records':records,'provider_request_count':len([e for e in events if e['kind']=='provider-request']),'terminal_input_count':len([e for e in events if e['kind']=='terminal-input']),'bracketed_paste_markers':len([e for e in events if e['kind']=='terminal-input' and ('\x1b[200~' in e.get('data','') or '\x1b[201~' in e.get('data',''))]),'shutdown_records':[e for e in events if e['kind']=='shutdown']}})
    summary['runs'].append(entry)
ok=not summary['error'] and len(summary['runs'])==3 and all(r['status']=='PASS' and r['error'] is None and r['exit_status']==0 and r['product_code_unchanged'] and all(r['cleanup'].get(k) for k in ['natural_cli_exit','actual_pid_gone','unique_server_stopped','isolated_config_removed']) and r['cleanup'].get('pane_dead_status')=='0' and r['raw_frame']['initial_full_width_border_offset']>=0 and len(r['events']['submit_records'])==1 and r['events']['provider_request_count']==1 for r in summary['runs'])
summary['status']='PASS' if ok else 'FAIL';summary['exit_status']=0 if ok else 1
(RESEARCH/'tmux-validation.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'status':summary['status'],'error':summary['error'],'runs':[{'attempt':r['attempt'],'status':r['status'],'error':r['error'],'exit_status':r['exit_status'],'raw_frame':r['raw_frame'],'events':r['events'],'cleanup':r['cleanup']} for r in summary['runs']]},indent=2,ensure_ascii=False))
sys.exit(summary['exit_status'])
