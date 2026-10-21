import './host-env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDiagnosticReport,formatDiagnostics,DIAGNOSTIC_LIMITS} from '../lib/initialization/diagnostics.ts';
import {diagnosticReportLines,isDiagnosticReport,CHECK_REPORT_TYPE,registerDiagnosticReport} from '../lib/initialization/diagnostic-report.ts';
import {registerInitCommand,ACTIONS} from '../lib/initialization/command.ts';
const row=(status='pass',severity='info',summary=status)=>({id:summary,category:'runtime',status,severity,summary,evidence:['resource-path'],impact:'impact detail',advice:'next action'});
const result=(items=[],omitted=0)=>({schemaVersion:1,scope:{cwd:'/project'},items,omitted,facts:{}});
const text=lines=>lines.map(l=>l.text).join('\n');

test('six states have separate counts, priority and compact/expanded details',()=>{
 const r=result([row('pass'),row('skipped'),row('cancelled'),row('blocked'),row('issue','warning','warning summary'),row('issue','error','error summary')]);
 const report=buildDiagnosticReport(r),compact=text(report.compact),expanded=text(report.expanded);
 assert.match(compact,/Check project · Needs attention · Cancelled/);
 for(const name of ['Errors','Warnings','Passed','Blocked','Skipped','Cancelled'])assert.match(compact,new RegExp(name+' 1'));
 assert.ok(compact.indexOf('[Error]')<compact.indexOf('[Warning]'));
 assert.match(compact,/Next: next action/);assert.match(compact,/✓ Passed: runtime/);
 assert.doesNotMatch(compact,/resource-path|impact detail/);assert.match(expanded,/Location\/evidence: resource-path/);assert.match(expanded,/Impact: impact detail/);
 assert.match(expanded,/\[Passed\]/);assert.equal(formatDiagnostics(r),expanded);
 assert.equal(report.compact.find(l=>l.text.includes('[Error]')).tone,'error');
 assert.equal(report.compact.find(l=>l.text.includes('[Warning]')).tone,'warning');
 assert.equal(report.compact.find(l=>l.text.includes('[Skipped]')).tone,'muted');
 assert.ok(isDiagnosticReport(report));
});

for(const [items,outcome,tone] of [
 [[row()], 'No errors found','success'],
 [[row('issue','warning')],'Warnings found','warning'],
 [[row('blocked')],'No errors found · Verification incomplete','warning'],
 [[row('skipped')],'No errors found · Verification incomplete','accent'],
 [[row('cancelled')],'No errors found · Cancelled','accent'],
])test(`honest outcome: ${outcome}`,()=>{const report=buildDiagnosticReport(result(items));assert.equal(report.compact[0].text,'Check project · '+outcome);assert.equal(report.compact[0].tone,tone);assert.doesNotMatch(text(report.compact),/all checks passed|not applicable/i);});

test('preview hiding is not a collection omission; expanded evidence and budget omissions are explicit',()=>{
 const preview=buildDiagnosticReport(result(Array.from({length:8},(_,i)=>row('issue','error','error '+i))));
 assert.equal((text(preview.compact).match(/\[Error\]/g)||[]).length,3);assert.match(text(preview.compact),/5 more items hidden/);assert.doesNotMatch(text(preview.compact),/omitted by/);
 assert.equal((text(preview.expanded).match(/\[Error\]/g)||[]).length,8);
 const large=buildDiagnosticReport({...result(Array.from({length:64},()=>({...row('issue','error','字'.repeat(500)),evidence:Array.from({length:12},()=> '字'.repeat(500))})),2),omittedCategories:['host\u202e']});
 for(const lines of [large.compact,large.expanded]){assert.ok(Buffer.byteLength(text(lines))<=DIAGNOSTIC_LIMITS.report);assert.match(text(lines),/Results incomplete/);assert.match(text(lines),/omitted by the report budget/);assert.match(text(lines),/Omitted categories: host/);assert.doesNotMatch(text(lines),/\u202e/);}
 const detailOnly=buildDiagnosticReport(result(Array.from({length:8},()=>({...row('issue','error'),evidence:Array.from({length:12},()=> '字'.repeat(500))}))));
 assert.match(text(detailOnly.expanded),/Results incomplete/);assert.match(text(detailOnly.compact),/Results incomplete/);
 assert.match(text(detailOnly.compact),/Some diagnostic details were omitted/);
 assert.ok(isDiagnosticReport(large));
});

test('snapshots sanitize external controls and reject unsafe restored details; fallback is bounded',()=>{
 const report=buildDiagnosticReport({...result([row('issue','error','bad\x1b[31m\n\u202e')]),scope:{cwd:'/project\x1b'}});
 assert.doesNotMatch(JSON.stringify(report),/\\u001b|\\u202e/);assert.ok(isDiagnosticReport(report));
 assert.deepEqual(diagnosticReportLines(report,'fallback',false),report.compact);assert.deepEqual(diagnosticReportLines(report,'fallback',true),report.expanded);
 for(const bad of [null,{}, {version:2}, {...report,compact:[{text:'\x1b[31m',tone:'error'}]}, {...report,expanded:[{text:'x',tone:'unknown'}]}, {...report,compact:Array(1101).fill({text:'x',tone:'text'})}]){
  assert.equal(isDiagnosticReport(bad),false);assert.equal(text(diagnosticReportLines(bad,'safe\ntext\x1b',false)),'safe\ntext ');
 }
 assert.ok(Buffer.byteLength(text(diagnosticReportLines(null,'字'.repeat(20000),false)))<=DIAGNOSTIC_LIMITS.report);
});

test('notification shell preserves report-owned compact and expanded budgets without a second text preview',()=>{
 let renderer;
 registerDiagnosticReport({registerMessageRenderer:(_type, value)=>{renderer=value;}});
 const report=buildDiagnosticReport(result(Array.from({length:8},(_,i)=>row('issue','error','error '+i))));
 const theme={fg:(_tone,text)=>text,bg:(_tone,text)=>text};
 const compact=renderer({content:text(report.expanded),details:report},{expanded:false,outputPad:0},theme).render(160).join('\n');
 assert.match(compact,/trellis_check/);
 assert.equal((compact.match(/\[Error\]/g)||[]).length,3);
 assert.match(compact,/5 more items hidden/);
 const expanded=renderer({content:text(report.expanded),details:report},{expanded:true,outputPad:0},theme).render(160).join('\n');
 assert.equal((expanded.match(/\[Error\]/g)||[]).length,8);
});


test('menu Check registers renderer and publishes one persistent message, no notification/model turn',async t=>{
 const root=mkdtempSync(join(tmpdir(),'trellis-report-menu-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const commands=new Map(),renderers=new Map(),messages=[],notices=[];let refreshes=0;
 const r=result([row('issue','warning')]);
 registerInitCommand({registerCommand:(n,c)=>commands.set(n,c),registerMessageRenderer:(n,r)=>renderers.set(n,r),sendMessage:(...args)=>messages.push(args)},async()=>{refreshes++;},async(_ctx,scope)=>{assert.equal(scope.cwd,root);return r;});
 assert.ok(renderers.has(CHECK_REPORT_TYPE));
 const ctx={cwd:root,hasUI:true,ui:{select:async()=>ACTIONS.check,notify:(...a)=>notices.push(a)}};
 await commands.get('trellis-init').handler('',ctx);
 assert.equal(messages.length,1);assert.equal(messages[0].length,1);assert.equal(messages[0][0].customType,CHECK_REPORT_TYPE);assert.equal(messages[0][0].display,true);
 assert.equal(messages[0][0].content,formatDiagnostics(r));assert.ok(isDiagnosticReport(messages[0][0].details));assert.deepEqual(notices,[]);assert.equal(refreshes,0);
 // Invoke the registered callback without mounting/rendering a TUI or running a host menu flow.
 const colors=[];const theme={fg:(tone,s)=>{colors.push(tone);return s;},bg:(_tone,s)=>s};
 renderers.get(CHECK_REPORT_TYPE)(messages[0][0],{expanded:false,outputPad:2},theme);
 assert.ok(colors.includes('warning'));assert.ok(colors.includes('muted'));assert.ok(colors.includes('text'));
 assert.doesNotMatch(JSON.stringify(messages[0][0]),/\\u001b/);
});

test('suppressed stale/cancelled result does not publish; non-check notices retain behavior',async t=>{
 const root=mkdtempSync(join(tmpdir(),'trellis-report-suppressed-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let command;const messages=[],notices=[];
 registerInitCommand({registerCommand:(_n,c)=>command=c,registerMessageRenderer:()=>{},sendMessage:m=>messages.push(m)},async()=>{},async()=>undefined);
 const ctx={cwd:root,hasUI:true,ui:{select:async()=>ACTIONS.check,notify:s=>notices.push(s)}};
 await command.handler('',ctx);assert.deepEqual(messages,[]);assert.deepEqual(notices,[]);
 await command.handler('--check',ctx);assert.match(notices[0],/takes no arguments/);assert.deepEqual(messages,[]);
});
