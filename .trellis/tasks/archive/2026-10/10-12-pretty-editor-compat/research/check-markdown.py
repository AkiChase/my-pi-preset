from pathlib import Path
from urllib.parse import unquote
import re
import unicodedata

files = [Path('README.md'), *Path('extensions/pretty-compat').rglob('*.md'),
         *Path('.trellis/tasks/10-12-pretty-editor-compat').rglob('*.md')]
errors = []
count = 0


def anchors(text):
    result, seen = set(), {}
    for line in text.splitlines():
        match = re.match(r'^#{1,6}\s+(.+)', line)
        if not match:
            continue
        heading = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', match[1]).replace('`', '').lower()
        slug = ''.join(c for c in heading if c in '-_ ' or unicodedata.category(c)[0] in 'LN').replace(' ', '-')
        number = seen.get(slug, 0)
        seen[slug] = number + 1
        result.add(slug + (f'-{number}' if number else ''))
    return result


for file in files:
    for link in re.findall(r'!?\[[^]\n]*\]\(([^)\s]+)(?:\s+[^)]*)?\)', file.read_text()):
        if re.match(r'^[a-zA-Z][\w+.-]*:', link):
            continue
        count += 1
        target, _, anchor = unquote(link).partition('#')
        destination = file.parent / target if target else file
        if not destination.exists():
            errors.append(f'{file}: missing {link}')
        elif anchor and destination.suffix == '.md' and anchor not in anchors(destination.read_text()):
            errors.append(f'{file}: missing anchor {link}')

for file in [Path('README.md'), Path('extensions/bash-unified.ts'),
             *Path('extensions/pretty-compat').rglob('*'),
             *Path('.trellis/tasks/10-12-pretty-editor-compat').rglob('*.md')]:
    if not file.is_file() or file.suffix not in ['.md', '.ts', '.mjs']:
        continue
    for number, line in enumerate(file.read_text().splitlines(), 1):
        if line.rstrip() != line:
            errors.append(f'{file}:{number}: trailing whitespace')

print(f'Checked {len(files)} Markdown files, {count} local links and changed/new code whitespace.')
print('\n'.join(errors) if errors else 'PASS: no missing links/anchors or trailing whitespace.')
raise SystemExit(bool(errors))
