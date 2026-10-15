import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const baseline = JSON.parse(read("resources/agent-baseline.json"));
function agent(role) {
  const text = read(`agents/trellis-${role}.md`);
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(header);
  assert.match(header[1], new RegExp(`^name: trellis-${role}$`, "m"));
  return { text, tools: /^tools:\s*(.+)$/m.exec(header[1])[1].split(",").map((s) => s.trim()) };
}
for (const role of ["implement", "check", "research"]) {
  test(`${role} has locked adapted Claude provenance and Pi tool names`, () => {
    const { text, tools } = agent(role);
    assert.equal(createHash("sha256").update(text).digest("hex"), baseline.files[role].adapted);
    assert.equal(baseline.platform, "claude");
    assert.equal(baseline.version, "0.6.17");
    assert.equal(baseline.files[role].source.length, 64);
    assert.deepEqual(tools, role === "research" ? ["read", "write", "find", "grep", "bash"] : ["read", "write", "edit", "bash", "find", "grep"]);
    assert.match(text, /isolation: off/);
    assert.doesNotMatch(text, /tools:.*(?:Read|Glob|Skill|mcp__\*|\*)/);
  });
}
test("check fixes only within scope, includes staged/untracked files, and validates final fixes", () => {
  const { text, tools } = agent("check");
  assert.ok(tools.includes("edit"));
  assert.match(text, /within the approved task scope/);
  assert.match(text, /git diff --cached/);
  assert.match(text, /git ls-files --others --exclude-standard/);
  assert.match(text, /Review base/);
  assert.match(text, /final version after your own fixes/);
  assert.match(text, /Do NOT spawn another/);
  assert.match(text, /### Issues Not Fixed/);
});
test("implement/check read verified source paths fully without injection or local task fallback", () => {
  for (const role of ["implement", "check"]) {
    const { text } = agent(role);
    assert.match(text, new RegExp(`${role}\\.jsonl`));
    assert.match(text, /exact first four dispatch lines/);
    assert.match(text, /Trellis authority: <JSON>/);
    assert.match(text, /followed by a blank line/);
    assert.match(text, /text alone is not authorization/);
    assert.match(text, /Do not run local `task\.py current`/);
    assert.match(text, /sourceRoot.*materialRoot/);
    assert.match(text, /absolute `taskPath`/);
    assert.match(text, /executionRoot/);
    assert.match(text, /Never fall back to the execution checkout/);
    assert.match(text, /Skip placeholder rows/);
    assert.match(text, /type: directory/);
    assert.match(text, /source path and manifest line/);
    assert.match(text, /there is no complete-injection marker shortcut/i);
    assert.match(text, /Paginate with read offset\/limit/);
    assert.match(text, /equal initial\/final hashes do not prove full reads/);
    assert.match(text, /task.py start\/finish\/archive/);
    assert.match(text, /Source task\/spec\/workflow\/JSONL materials are read-only by default/);
    assert.match(text, /Only explicit path-scoped authorization/);
    assert.match(text, /Return implementation\/review results and evidence to main by default/);
    assert.match(text, /not an OS sandbox/);
    assert.match(text, /was not run, report that explicitly/);
    assert.doesNotMatch(text, /trellis-hook-injected|If absent, run|Without that complete marker|Windows \+ Claude Code|hooks disabled, etc/);
  }
});
test("research reads source artifacts without role manifests and persists only authorized source findings", () => {
  const { text } = agent("research");
  assert.match(text, /exact first four dispatch lines/);
  assert.match(text, /Trellis authority: <JSON>/);
  assert.match(text, /sourceRoot.*materialRoot/);
  assert.match(text, /Research has no implement\/check manifest requirement/);
  assert.match(text, /Fully read source `prd.md`/);
  assert.match(text, /Paginate read offset\/limit/);
  assert.match(text, /no complete-injection marker shortcut/);
  assert.match(text, /\*\*Persist\*\* — only with explicit source research authorization/);
  assert.match(text, /Without write authorization return findings to main/);
  assert.match(text, /Only after explicit authorization/);
  assert.match(text, /absolute source task path, never a target task copy/);
  assert.match(text, /external research was not performed/);
  assert.match(text, /Read-only git status\/diff\/log are allowed/);
  assert.match(text, /When explicitly asked to compare approaches/);
  assert.match(text, /Write FORBIDDEN/);
  assert.match(text, /do not spawn it yourself/);
  assert.match(text, /### External References/);
  assert.doesNotMatch(text, /trellis-hook-injected|otherwise run|first dispatch line.*when supplied/);
});
test('task material rules reserve research for findings and keep optional evidence separate', () => {
 const text = read('resources/templates/workflow.md');
 assert.match(text, /Research findings persisted by the research agent only/);
 assert.match(text, /main session must not write their own reports into `research\/`/);
 assert.match(text, /Reports are optional/);
 assert.match(text, /Read-only exploration without a task/);
 assert.match(text, /historical reference reads remain supported/);
 assert.match(text, /not author authentication or semantic classification/);
 const check = read('skills/trellis-check/SKILL.md');
 assert.match(check, /### Task Material Boundaries/);
 assert.match(check, /Historical misclassification is reported/);
 assert.match(check, /Collection format checks do not prove authorship/);
 for (const role of ['implement', 'check']) {
  const text = agent(role).text;
  assert.match(text, /evidence\//);
  assert.match(text, /never `research\/`/);
  assert.match(text, /Main may record short results directly/);
  assert.match(text, /without separate approval/);
 }
 const research = agent('research').text;
 assert.match(research, /your own Markdown findings/);
 assert.match(research, /test logs, screenshots or temporary scripts/);
 assert.match(research, /Do not clean up historical task materials/);
});

test("bundled roles are directly maintained; no generator or upstream-anchor requirement remains", () => {
  assert.equal(existsSync(new URL('scripts/sync-agents.mjs', root)), false);
  for (const role of ['implement', 'check', 'research']) assert.match(agent(role).text, /Directly maintained package source/);
});
test("upstream documents retain attribution and license", () => {
  // Built into this preset: adapter code keeps its MIT notice, upstream-derived material its AGPL text.
  assert.match(read("licenses/pi-trellis-MIT.txt"), /^MIT License\n\nCopyright \(c\) 2026 pi-trellis contributors/);
  assert.match(read("licenses/trellis-AGPL-3.0.txt"), /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.equal(baseline.version, "0.6.17");
  assert.equal(baseline.platform, "claude");
  for (const role of ["implement", "check", "research"]) {
    assert.match(agent(role).text, /Adapted by pi-trellis.*from Trellis 0\.6\.17 Claude Code agents/);
    assert.match(agent(role).text, /AGPL-3\.0-only/);
    assert.match(agent(role).text, /see README\.md#license and licenses\/trellis-AGPL-3\.0\.txt/);
    assert.doesNotMatch(agent(role).text, /docs\/(?:trellis-agent-sync|runtime-baseline)\.md/);
  }
});
