"""Local docs audit: files, anchors, language and active role references; no product execution."""
from pathlib import Path
from urllib.parse import unquote
import json
import re
import sys

ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / 'pi-preset.json').is_file() and (parent / '.trellis/spec').is_dir())
FILES = sorted((ROOT / '.trellis/spec').rglob('*.md')) + sorted((ROOT / 'docs').rglob('*.md')) + [ROOT / 'README.md']
errors = []
link_count = 0

def anchors(text):
    result = set(re.findall(r'(?:id|name)=[\"\']([^\"\']+)', text))
    counts = {}
    for heading in re.findall(r'^#{1,6}\s+(.+)$', text, re.M):
        slug = heading.lower().replace('`', '')
        slug = re.sub(r'[^\w\-\s]', '', slug).replace(' ', '-')
        n = counts.get(slug, 0)
        counts[slug] = n + 1
        result.add(slug if n == 0 else f'{slug}-{n}')
    return result

for path in FILES:
    text = path.read_text(encoding='utf-8')
    rel = path.relative_to(ROOT)
    if not text.endswith('\n'):
        errors.append(f'{rel}: missing final newline')
    for number, line in enumerate(text.splitlines(), 1):
        if line.rstrip() != line:
            errors.append(f'{rel}:{number}: trailing whitespace')
    if path.is_relative_to(ROOT / '.trellis/spec') and re.search(r'[\u4e00-\u9fff]', text):
        errors.append(f'{rel}: spec contains Chinese prose')
    if path.is_relative_to(ROOT / 'docs') and not re.search(r'[\u4e00-\u9fff]', text):
        errors.append(f'{rel}: user document has no Chinese prose')
    for link in re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)', text):
        if re.match(r'^[a-zA-Z][\w+.-]*:', link):
            continue
        link_count += 1
        target, _, anchor = link.partition('#')
        target = unquote(target.split(' "', 1)[0])
        resolved = (path.parent / target).resolve() if target else path
        if not resolved.exists():
            errors.append(f'{rel}: missing link {link}')
        elif anchor and resolved.is_file() and resolved.suffix == '.md':
            if unquote(anchor) not in anchors(resolved.read_text(encoding='utf-8')):
                errors.append(f'{rel}: missing anchor {link}')

for forbidden in (ROOT / 'docs/testing', ROOT / '.trellis/spec/preset'):
    if forbidden.exists():
        errors.append(f'{forbidden.relative_to(ROOT)}: retired directory remains')
for layer in ('development', 'testing'):
    p = ROOT / '.trellis/spec' / layer / 'index.md'
    if not p.is_file() or len(p.read_text().splitlines()) < 20:
        errors.append(f'{layer}: missing/substance-free layer index')

for entry, guide in {
    'at-path-completion': 'at-path-completion', 'beautify': 'beautify',
    'blocked-signal': 'blocked-signal', 'session-name': 'session-name',
    'sse-normalize': 'sse-normalize', 'status-bar': 'status-bar',
    'task-composition': 'task-composition',
}.items():
    p = ROOT / 'extensions' / f'{entry}.ts'
    if p.exists() and not (ROOT / 'docs/extensions' / f'{guide}.md').is_file():
        errors.append(f'{entry}: missing user guide')
manifest = json.loads((ROOT / 'pi-preset.json').read_text())
package_guides = {
    'npm:pi-cache-optimizer': 'cache-optimizer',
    'npm:pi-input-history': 'input-history',
    'npm:pi-web-access': 'web-access',
    'npm:pi-memory': 'memory',
    'npm:@juicesharp/rpiv-ask-user-question': 'ask-user-question',
    'npm:@tifan/pi-recap': 'recap',
}
for source in manifest['packages']:
    if source == 'git:github.com/AkiChase/my-pi-preset':
        continue
    guide = package_guides.get(source)
    if guide is None or not (ROOT / 'docs/packages' / f'{guide}.md').is_file():
        errors.append(f'{source}: missing user guide/mapping')
known_entries = {'at-path-completion', 'beautify', 'blocked-signal', 'session-name', 'sse-normalize', 'status-bar', 'task-composition'}
for p in (ROOT / 'extensions').glob('*.ts'):
    if p.stem not in known_entries:
        errors.append(f'{p.name}: new entry needs user guide mapping')

context_count = 0
for task in (ROOT / '.trellis/tasks').iterdir():
    if not task.is_dir() or task.name == 'archive':
        continue
    for path in task.rglob('*.jsonl'):
        if path.name not in ('implement.jsonl', 'check.jsonl', 'research.jsonl'):
            continue
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise ValueError('context row is not an object')
                if 'file' in row:
                    context_count += 1
                    if not isinstance(row['file'], str) or not (ROOT / row['file']).exists():
                        errors.append(f'{path.relative_to(ROOT)}:{number}: missing context {row["file"]}')
            except (ValueError, TypeError) as exc:
                errors.append(f'{path.relative_to(ROOT)}:{number}: invalid JSONL: {exc}')
print(f'Audited {len(FILES)} documents, {link_count} local links/anchors, {context_count} active context references; {len(errors)} issue(s)')
for error in errors:
    print(error)
sys.exit(bool(errors))
