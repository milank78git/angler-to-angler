"""Index the effective SQL definitions in Liquibase deployment order."""
import argparse
from difflib import unified_diff
from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
changelog = root / 'db/changelog.xml'
definition = re.compile(
    r'^\s*(create (?:or replace )?function|alter function|drop function)\s+([\w.]+)\s*\(([^()]*)\)\s*'
    r'(returns\b|rename to (\w+)|;)', re.I | re.M)
declaration = re.compile(r'^\s*(?:create (?:or replace )?function|alter function|drop function)\s+', re.I | re.M)


def signatures():
    current = {}
    entries = ET.parse(changelog).findall('./{*}changeSet/{*}sqlFile')
    paths = [(changelog.parent / entry.attrib['path']).resolve() for entry in entries]
    expected = sorted((root / 'supabase/migrations').glob('*.sql'))
    if paths != expected:
        delta = unified_diff([str(p.relative_to(root)) for p in paths],
                             [str(p.relative_to(root)) for p in expected],
                             fromfile='db/changelog.xml', tofile='migration files in timestamp order', lineterm='')
        raise SystemExit('\n'.join(delta))
    for path in paths:
        sql = path.read_text()
        for header in declaration.finditer(sql):
            match = definition.match(sql, header.start())
            if not match:
                raise ValueError(f'Unrecognized function declaration in {path.name} at {header.start()}')
            kind, name, args, _, rename = match.groups()
            types = []
            for arg in filter(str.strip, args.split(',')):
                value = re.split(r'\s+default\s+', arg.strip(), flags=re.I)[0].lower()
                if kind.lower().startswith('create'):
                    value = value.split(maxsplit=1)[1]
                types.append({'int': 'integer', 'bool': 'boolean', 'timestamptz': 'timestamp with time zone'}.get(value, value))
            key = name.lower(), ', '.join(types)
            line = sql.count('\n', 0, match.start(1)) + 1
            source = f'../{path.relative_to(root)}#L{line}'
            if kind.lower().startswith('drop'):
                del current[key]
            elif rename:
                definition_source, _ = current.pop(key)
                renamed = name.rsplit('.', 1)[0] + '.' + rename.lower()
                current[renamed, key[1]] = definition_source, source
            else:
                current[key] = source, None
    return current


def render():
    rows = ['# Database function index', '',
            'Active signatures in Liquibase deployment order. Each link opens the effective definition. '
            'Renamed functions also link to the migration that assigned their current name.', '',
            '| Function signature | Definition | Rename |', '| --- | --- | --- |']
    for (name, args), (source, rename) in sorted(signatures().items()):
        def link(target):
            return f'[{target.split("/")[-1].split("_")[0]}]({target})' if target else ''
        rows.append(f'| `{name}({args})` | {link(source)} | {link(rename)} |')
    return '\n'.join(rows) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--signatures', action='store_true')
    args = parser.parse_args()
    if args.signatures:
        for name, types in sorted(signatures()):
            print(f'{name}({types})')
        raise SystemExit(0)
    index = root / 'db/functions.md'
    content = render()
    if args.check:
        if not index.exists() or index.read_text() != content:
            raise SystemExit('Regenerate db/functions.md with python3 scripts/index-db-functions.py')
    else:
        index.write_text(content)
