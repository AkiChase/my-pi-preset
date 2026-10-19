import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Trellis resource root; tests never depend on the process cwd.
const pkg = fileURLToPath(new URL('..', import.meta.url));
const at = path => join(pkg, path);

const workflow = readFileSync(at('resources/templates/workflow.md'), 'utf8');

test('workflow separates implementation from review and retains authorization boundaries', () => {
 assert.match(workflow, /Main implements → main self-reviews/);
 assert.match(workflow, /Main implements → `trellis-check` independently reviews/);
 assert.match(workflow, /Require independent review for high-risk changes/);
 assert.match(workflow, /self-review is never independent review/);
 assert.match(workflow, /#### 3\.4 Commit \[conditional\]/);
 assert.match(workflow, /If the user requested no commits, leave changes uncommitted/);
 assert.match(workflow, /--allow-empty-context/);
 assert.match(workflow, /not approval, spec reading or context preparation/);
 assert.doesNotMatch(workflow, /Main session: dispatch implement then independent check|The main session dispatches `trellis-implement`/);
 assert.doesNotMatch(workflow, /[\u3400-\u9fff]/);
 for (const status of ['no_task', 'task_error', 'planning', 'in_progress', 'completed']) {
  const matches = [...workflow.matchAll(new RegExp(`\\[workflow-state:${status}\\]\\n([\\s\\S]*?)\\n\\[/workflow-state:${status}\\]`, 'g'))];
  assert.equal(matches.length, 1, status);
  assert.ok(matches[0][1].trim());
 }
});

test('request triage lets small tasks skip Trellis and keeps the AGENTS block a directory pointer', () => {
 const triage = workflow.slice(workflow.indexOf('### Request Triage'), workflow.indexOf('## Phase 1: Plan'));
 assert.ok(triage.length > 20);
 assert.match(triage, /ask only whether this turn should create a Trellis task/);
 assert.match(triage, /skip Trellis for this session/);
 assert.match(triage, /Leave changes uncommitted unless the user explicitly asks for a commit/);
 assert.match(triage, /stop and ask again whether to create a Trellis task/);
 const noTask = workflow.match(/\[workflow-state:no_task\]\n([\s\S]*?)\n\[\/workflow-state:no_task\]/)[1];
 assert.match(noTask, /ask only whether this turn should create a Trellis task/);
 assert.match(noTask, /skip Trellis for this session/);
 assert.doesNotMatch(workflow, /task\/planning approval/);
 const start = readFileSync(at('skills/trellis-start/SKILL.md'), 'utf8');
 assert.match(start, /Request Triage[\s\S]*direct edit/);
 assert.doesNotMatch(start, /New work still requires task\/planning approval/);
 const block = readFileSync(at('resources/templates/agents-block.md'), 'utf8');
 assert.match(block, /^<!-- TRELLIS:START -->\n[\s\S]*\n<!-- TRELLIS:END -->\n$/);
 assert.match(block, /`\.trellis\/workflow\.md`/);
 assert.doesNotMatch(block, /trellis-init|require user approval/);
});

test('retention separates temporary execution output from selected permanent evidence', () => {
 const check = readFileSync(at('skills/trellis-check/SKILL.md'), 'utf8');
 const finish = readFileSync(at('skills/trellis-finish-work/SKILL.md'), 'utf8');
 const materials = workflow.slice(workflow.indexOf('### Task Material Boundaries'), workflow.indexOf('### Planning and Dispatch Context'));
 for (const pattern of [/outside the repository in the system temporary directory/, /mktemp -d/, /Raw stdout\/stderr, full event streams/, /bulk terminal\s+text\/ANSI/, /temporary drivers\/launch scripts/, /debug fingerprints/, /not in task `evidence\/` or a repository `\.tmp\/`/, /until main has checked the failure and any rerun/, /concise results, unresolved issues and temporary paths/, /not copy raw output/, /not required per role or stage/, /failure causes and rerun relationships/, /a later PASS must not erase earlier failures/, /does not require permanent\s+retention of every raw output/, /self-contained/, /minimal, sanitized material/, /state its purpose/, /existing execution or wrap-up authorization/, /no active process still uses it/, /ownership\/authorization is uncertain/, /cleanup fails/, /report why and\s+where/, /Never broadly clean/, /historical tasks without\s+separate approval/]) assert.match(materials, pattern);
 assert.match(materials, /Within existing execution or wrap-up authorization, remove only this run's owned temporary directory\s+once main has verified the materials and no active process still uses it/);
 const dispatch = workflow.slice(workflow.indexOf('#### 2.1'), workflow.indexOf('#### 2.2'));
 assert.match(dispatch, /including ordinary agents/);
 assert.match(dispatch, /permission is not a request to persist every intermediate file/);
 const commit = workflow.slice(workflow.indexOf('#### 3.4'), workflow.indexOf('#### 3.5'));
 assert.match(commit, /Before any commit that includes a task directory/);
 assert.match(commit, /tracked and\s+untracked new materials/);
 assert.match(commit, /minimum useful retained set/);
 const wrap = workflow.slice(workflow.indexOf('#### 3.5'), workflow.indexOf('## Breadcrumbs'));
 assert.match(wrap, /retention review before\s+journal or archive, including untracked files/);
 assert.match(check, /outside the repository, not task `evidence\/`/);
 assert.match(check, /checked before discarding diagnostic materials/);
 assert.match(check, /Separate reports are optional, not required per role or stage/);
 assert.match(check, /only reports worth retaining use `evidence\/`, never `research\/`/);
 assert.match(check, /without duplicate reports or reliance only on temporary links/);
 assert.match(check, /tracked and untracked new materials have passed retention review/);
 assert.match(finish, /Before journal or archive/);
 assert.match(finish, /reports are optional/);
 assert.match(finish, /Within existing execution or wrap-up authorization, clean only this run's owned repository-external temporary directory after main has checked the materials and confirmed no active process still uses it/);
 assert.match(finish, /no active process still uses it/);
 assert.match(finish, /another session's output or historical task materials/);
 assert.match(finish, /diagnosis remains unresolved, ownership or authorization is uncertain, or cleanup fails/);
 assert.match(finish, /report the reason and location/);
 assert.match(finish, /not necessarily every raw file forever/);
});

test('associated skills do not restore mandatory paired dispatch or redundant plan approval', () => {
 for (const name of ['start', 'before-dev', 'brainstorm', 'check', 'finish-work', 'update-spec', 'break-loop']) {
  const text = readFileSync(at(`skills/trellis-${name}/SKILL.md`), 'utf8');
  assert.match(text, /Follow the (?:source )?project workflow for execution and review routing/);
  assert.doesNotMatch(text, /Main dispatches implementation\/check roles|must each contain at least one|fresh implementation approval|Only a subsequent user message/);
 }
 const brainstorm = readFileSync(at('skills/trellis-brainstorm/SKILL.md'), 'utf8');
 assert.match(brainstorm, /already-reviewed, unchanged plan is sufficient bounded approval/);
 assert.match(brainstorm, /Task-creation consent alone is not implementation approval/);
 const check = readFileSync(at('skills/trellis-check/SKILL.md'), 'utf8');
 assert.match(check, /supports main-session self-review and independent `trellis-check` review/);
 assert.doesNotMatch(check, /Require independent review for high-risk permissions/);
});

test('stage commits happen at implementation checkpoints, not only final wrap-up', () => {
 const stage = workflow.slice(workflow.indexOf('#### 2.2'), workflow.indexOf('## Phase 3'));
 assert.match(stage, /immediately commits that stage unless the user explicitly opted out/);
 assert.match(stage, /Do not wait for\nwhole-task acceptance/);
 assert.match(stage, /Select hunks only when a file mixes/);
 assert.match(stage, /Sub-agents never commit/);
 assert.match(workflow, /Implementation approval includes scoped local commits/);
 assert.match(workflow, /No separate commit approval or repeated checkpoint questions/);
 assert.match(workflow, /Never push without explicit approval/);
 assert.match(workflow, /rebase or amend earlier history without explicit approval/);
 assert.doesNotMatch(workflow, /task-level commit approval|Without Git approval/);
 assert.match(workflow, /final Git review, not the first opportunity to commit/);
 const breadcrumb = workflow.split('[workflow-state:in_progress]')[1].split('[/workflow-state:in_progress]')[0];
 assert.match(breadcrumb, /commit it immediately unless the user opted out/);
 const finish = readFileSync(at('skills/trellis-finish-work/SKILL.md'), 'utf8');
 assert.match(finish, /Honor already-granted finish-work authorization without asking again/);
 assert.match(finish, /Code submission policy belongs to the project workflow/);
 assert.doesNotMatch(finish, /stage commits happen during Phase 2|task-level commit approval|Approved code commits belong to workflow step 3\.4/);
 const resume = readFileSync(at('skills/trellis-start/SKILL.md'), 'utf8');
 assert.match(resume, /return to \*\*2\.1\*\* for the next approved stage/);
 assert.match(resume, /current stage implemented but not checked/);
 assert.match(resume, /Document presence alone is not proof/);
 assert.match(resume, /task\.py active <task>/);
 assert.match(resume, /multiple sessions can bind the same task/);
 assert.match(resume, /all stages checked/);
});

test('finish-work authorization includes configured wrap-up commits without separate action approvals', () => {
 const finish = readFileSync(at('skills/trellis-finish-work/SKILL.md'), 'utf8');
 const wrap = workflow.slice(workflow.indexOf('#### 3.5'), workflow.indexOf('## Breadcrumbs'));
 for (const text of [finish, wrap]) {
  assert.match(text, /Authorization to run `trellis-finish-work`/);
  assert.match(text, /archive, deactivation, journal recording and\s+local commits/);
  assert.match(text, /do not ask for each action separately/);
  assert.match(text, /explicit\s+user restrictions/);
  assert.match(text, /session_auto_commit/);
  assert.match(text, /--no-commit/);
  assert.match(text, /parallel/);
  assert.match(text, /[Bb]efore (?:each command|execution)/);
  assert.match(text, /remaining changes/);
  assert.match(text, /failures?/);
  assert.match(text, /push or history rewriting/);
  assert.doesNotMatch(text, /With (?:archive|journal) authorization|finish\/archive\/journal authorization/);
 }
 const commands = finish.split('\n').filter(line => /^\d+\./.test(line) && line.includes('python3'));
 assert.equal(commands.length, 3);
 for (const command of commands) assert.doesNotMatch(command, /--no-commit/, 'ordinary commands retain configured auto-commit');
 assert.match(finish, /Use `--no-commit` only when the user explicitly forbids commits or/);
 assert.match(finish, /If `session_auto_commit: false`, do not bypass it with manual commits/);
 assert.match(wrap, /Do not bypass disabled auto-commit\nconfiguration with manual commits/);
 assert.match(finish, /current developer's journal files\/index and current bound task/);
 assert.match(finish, /source\/destination and affected child task paths/);
 assert.match(finish, /Scoped paths protect unrelated staged files, not parallel changes within those paths/);
 assert.match(finish, /report the blocker if safe separation is uncertain/);
 assert.match(finish, /An auto-commit failure is not successful submission/);
 assert.match(finish, /Configured skips remain uncommitted and must be reported/);
 assert.match(finish, /unfinished work must not be archived/);
 assert.match(finish, /Never implicitly commit product code/);
 const completed = workflow.split('[workflow-state:completed]')[1].split('[/workflow-state:completed]')[0];
 assert.match(completed, /Finish-work authorization covers applicable/);
 assert.doesNotMatch(completed, /Archive\/journal need authorization/);
});

test('workflow and entry skills keep source authority separate from execution and child write approval', () => {
 // The published template is the product; a project's deployed copy is project state, not tested here.
 for (const text of [workflow]) {
  assert.match(text, /host-validated exact four-line header/);
  assert.match(text, /Trellis authority: <JSON>/);
  assert.match(text, /then a blank line/);
  assert.match(text, /No task\/spec\nexecution copy is prepared/);
  assert.match(text, /Git-checkout `.trellis` stays unchanged/);
  assert.match(text, /selected source JSONL and all references/);
  assert.match(text, /research has no implement\/check manifest requirement/);
  assert.match(text, /Resolve relative material rows from sourceRoot and code\/tests from executionRoot/);
  assert.match(text, /Paginate until complete/);
  assert.match(text, /read-only for children by default/);
  assert.match(text, /Explicit path-scoped authorization/);
  assert.match(text, /Main verifies obsolete references and repairs them/);
  assert.doesNotMatch(text, /unless a complete injection|marker is present in the task-context block|Read omitted materials|refresh --task|collect --task/);
 }
 for (const name of ['start']) {
  const text = readFileSync(at(`skills/trellis-${name}/SKILL.md`), 'utf8');
  assert.match(text, /exact four-line header/);
  assert.match(text, /absolute sourceRoot\/materialRoot/);
  assert.match(text, /no local `task.py current`/);
  assert.match(text, /paginate read offset\/limit until complete/);
  assert.match(text, /Main owns integration, reference repair and lifecycle/);
  assert.match(text, /source evidence\/research writes require explicit path-scoped authorization/);
  assert.match(text, /never dispatch recursively, start\/hooks, commit or finish/);
  assert.match(text, /No target material synchronization, binding migration/);
 }
});

test('all bundled skills use source materials and separate product execution roots', () => {
 const baseline = JSON.parse(readFileSync(at('resources/skill-baseline.json'), 'utf8'));
 const entries = Object.keys(baseline.files).filter(path => path.endsWith('/SKILL.md'));
 assert.ok(entries.length > 0);
 for (const path of entries) {
  const text = readFileSync(at(`skills/${path}`), 'utf8');
  // Most skills have a boundary footer; meta and spec-bootstrap put their
  // source/execution rules in existing prose rather than creating new sections.
  const boundaries = text.split('## Pi Execution Boundary');
  assert.ok(boundaries.length <= 2, path);
  const boundary = boundaries.at(-1);
  assert.match(boundary, /(?:Main-session `\.trellis\/\.\.\.` paths are relative to the source project|In the main session, `\.trellis(?:\/\.\.\.)?` material paths resolve from the source project root)/, path);
  assert.match(boundary, /Dispatched roles (?:use verified (?:absolute source material paths|authority to read absolute source material paths)|read absolute source material paths from verified authority)/, path);
  assert.match(boundary, /(?:separate executionRoot for code\/tests|code\/tests and their execution cwd (?:stay at|at) `executionRoot`|code and tests stay at `executionRoot`)/, path);
  assert.doesNotMatch(text, /All `\.trellis(?:\/\.\.\.)?`(?:\/`\.pi` project)? paths (?:are relative to the execution project|resolve from the execution root)/, path);
 }
});

test('real phase parser extracts every template step without neighboring bodies', t => {
 const root = mkdtempSync(join(tmpdir(), 'pi-workflow-'));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 mkdirSync(join(root, '.trellis'), { recursive: true });
 writeFileSync(join(root, '.trellis/workflow.md'), workflow);
 const code = `import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom common import workflow_phase as w\nw.get_repo_root=lambda:Path(sys.argv[2])\nids=['1.0','1.1','1.2','1.3','1.4','2.1','2.2','3.1','3.2','3.3','3.4','3.5']\nprint(json.dumps({'index':w.get_phase_index(),'steps':{i:w.filter_platform(w.get_step(i),'Pi') for i in ids}}))`;
 const r = spawnSync('python3', ['-B', '-c', code, resolve(pkg,'runtime'), root], { encoding: 'utf8' });
 assert.equal(r.status, 0, r.stderr);
 const result = JSON.parse(r.stdout);
 assert.match(result.index, /self-review or independent review/);
 assert.doesNotMatch(result.index, /####|workflow-state/);
 for (const [id, body] of Object.entries(result.steps)) {
  assert.ok(body.startsWith(`#### ${id} `), id);
  assert.equal([...body.matchAll(/^#### /gm)].length, 1, id);
  assert.doesNotMatch(body, /workflow-state/);
 }
 assert.match(result.steps['2.2'], /Main implements → `trellis-check`/);
});

test('existing runtime explicitly starts direct or check-only work without weakening default empty-context gate', t => {
 const root = mkdtempSync(join(tmpdir(), 'pi-direct-start-'));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 cpSync(resolve(pkg,'runtime'), join(root, '.trellis/scripts'), { recursive: true });
 const task = '.trellis/tasks/direct';
 mkdirSync(join(root, task), { recursive: true });
 const record = { id: 'direct', title: 'Direct work', description: 'Fixture', status: 'planning', children: [] };
 writeFileSync(join(root, task, 'task.json'), JSON.stringify(record));
 writeFileSync(join(root, task, 'prd.md'), 'Approved scope');
 writeFileSync(join(root, task, 'implement.jsonl'), '');
 writeFileSync(join(root, task, 'check.jsonl'), '');
 const env = { ...process.env, TRELLIS_CONTEXT_ID: 'workflow-fixture', PYTHONDONTWRITEBYTECODE: '1' };
 for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
 const run = args => spawnSync('python3', ['-B', join(root, '.trellis/scripts/task.py'), ...args], { cwd: root, env, encoding: 'utf8' });
 for (const checkOnly of [false, true]) {
  if (checkOnly) {
   mkdirSync(join(root, '.trellis/spec'), { recursive: true });
   writeFileSync(join(root, '.trellis/spec/review.md'), 'Review rules');
   writeFileSync(join(root, task, 'check.jsonl'), JSON.stringify({ file: '.trellis/spec/review.md', reason: 'Independent check' }) + '\n');
  }
  writeFileSync(join(root, task, 'task.json'), JSON.stringify(record));
  const rejected = run(['start', task]);
  assert.notEqual(rejected.status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, task, 'task.json'))).status, 'planning');
  assert.match(rejected.stdout + rejected.stderr, /no curated entries/);
  const started = run(['start', task, '--allow-empty-context']);
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, task, 'task.json'))).status, 'in_progress');
  assert.equal(JSON.parse(run(['current', '--json']).stdout).current_task.dir, task);
  assert.notEqual(run(['validate', task]).status, 0, 'empty unused manifest remains an honest validation diagnostic');
 }
});
