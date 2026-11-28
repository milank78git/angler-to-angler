"""Render per-line definition and call comments without changing packaged code or migration checksums."""
import argparse
import bisect
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from html import escape
from pathlib import Path
import re
import runpy

from tree_sitter import Language, Parser
import tree_sitter_java
import tree_sitter_javascript
import tree_sitter_typescript

ROOT = Path(__file__).resolve().parents[2]
PARSERS = {
    '.java': Parser(Language(tree_sitter_java.language())),
    '.js': Parser(Language(tree_sitter_javascript.language())),
    '.ts': Parser(Language(tree_sitter_typescript.language_typescript())),
}
PARSERS['.mjs'] = PARSERS['.js']
FUNCTIONS = {'function_declaration', 'function_expression', 'generator_function_declaration',
             'generator_function', 'arrow_function', 'method_definition', 'method_declaration',
             'constructor_declaration', 'lambda_expression'}
CALLS = {'call_expression', 'method_invocation', 'new_expression', 'object_creation_expression',
         'explicit_constructor_invocation'}


@dataclass(frozen=True)
class Note:
    line: int
    column: int
    kind: str
    text: str
    destination: str = ''


def short(node):
    """Keep nested expressions readable while preserving their exact source location in the listing."""
    if node is None:
        return ''
    value = ' '.join(node.text.decode().split())
    return value if len(value) <= 90 else value[:87] + '...'


def target(node):
    """Read the written call target, keeping the receiver for virtual and optional calls."""
    field = node.child_by_field_name
    if node.type == 'method_invocation':
        return '.'.join(filter(None, [short(field('object')), short(field('name'))]))
    return short(field('function') or field('type') or field('constructor')) or node.type


def function_name(node):
    """Identify declarations, assigned handlers and callbacks passed to another function."""
    name = node.child_by_field_name('name')
    if name:
        return short(name)
    parent = node.parent
    if parent.type == 'variable_declarator':
        return short(parent.child_by_field_name('name'))
    if parent.type in ('assignment_expression', 'pair'):
        return short(parent.child_by_field_name('left') or parent.child_by_field_name('key'))
    if parent.type in ('arguments', 'argument_list') and parent.parent.type in CALLS:
        return 'callback for ' + target(parent.parent)
    return 'callback at line ' + str(node.start_point.row + 1)


def nearby_doc(node):
    """Read the semantic part of the adjacent source comment, skipping pure type declarations."""
    wrappers = {'export_statement', 'lexical_declaration', 'variable_declarator', 'pair',
                'field_declaration', 'local_variable_declaration'}
    while node:
        prev, start = node.prev_named_sibling, node.start_point.row
        while prev and prev.type in {'comment', 'block_comment', 'line_comment'} and start <= prev.end_point.row + 1:
            value = re.sub(r'^/\*+|\*/$|^//\s*', '', prev.text.decode().strip())
            value = ' '.join(line.strip().lstrip('*').strip() for line in value.splitlines()).strip()
            description = re.split(r'(?:^|\s)@(param|returns?|template|type|override)\b', value, maxsplit=1)[0].strip()
            if description:
                return description
            start, prev = prev.start_point.row, prev.prev_named_sibling
        if not node.parent or node.parent.type not in wrappers:
            break
        # In a compound declaration the first binding's comment does not describe its siblings.
        if node.parent.type == 'lexical_declaration' and any(
            child.type == 'variable_declarator' and child.start_byte < node.start_byte for child in node.parent.named_children
        ):
            break
        node = node.parent
    return ''


def call_role(node):
    """Find how the nearest enclosing expression uses the result, stopping at another call or callback."""
    parent = node.parent
    while parent and parent.type not in FUNCTIONS:
        kind = parent.type
        if kind == 'await_expression':
            return 'Await completion of'
        if kind == 'return_statement':
            return 'Return the result of'
        if kind in ('if_statement', 'ternary_expression', 'while_statement'):
            cond = parent.child_by_field_name('condition')
            if cond and cond.start_byte <= node.start_byte < cond.end_byte:
                return 'Evaluate the condition using'
            break
        if kind in CALLS or kind in ('expression_statement', 'statement_block', 'block'):
            break
        parent = parent.parent
    return 'Call'


def filename(path):
    return path.relative_to(ROOT).as_posix().replace('/', '__') + '.html'


def descend(node):
    yield node
    for child in node.named_children:
        yield from descend(child)


class Symbols:
    """Link direct imports and explicit Java class calls only when the declaration is unambiguous."""

    def __init__(self, sources):
        self.definitions = defaultdict(list)
        self.imports = defaultdict(dict)
        self.classes = defaultdict(list)
        self.bindings = defaultdict(Counter)
        for path in sources:
            root = PARSERS[path.suffix].parse(path.read_bytes()).root_node
            if path.suffix == '.java':
                self.classes[path.stem].append(path)
            for node in descend(root):
                if node.type == 'import_statement':
                    module = short(node.child_by_field_name('source')).strip("'\"")
                    if module.startswith('.'):
                        for item in descend(node):
                            if item.type == 'import_specifier':
                                sym = short(item.child_by_field_name('name'))
                                local = short(item.child_by_field_name('alias')) or sym
                                self.imports[path][local] = ((path.parent / module).resolve(), sym)
                            elif item.type == 'namespace_import':
                                self.imports[path][short(item.named_children[-1])] = ((path.parent / module).resolve(), '*')
                if node.type in {'function_declaration', 'variable_declarator', 'class_declaration'}:
                    self.bindings[path][short(node.child_by_field_name('name'))] += 1
                elif node.type in {'formal_parameters', 'required_parameter', 'optional_parameter'}:
                    self.bindings[path].update(short(child) for child in node.named_children if child.type == 'identifier')
                if node.type not in FUNCTIONS:
                    continue
                name = function_name(node)
                if path.suffix == '.java':
                    if node.type not in {'method_declaration', 'constructor_declaration'}:
                        continue
                    cls = node.parent
                    while cls and cls.type not in {'class_declaration', 'enum_declaration', 'interface_declaration'}:
                        cls = cls.parent
                    if not cls or short(cls.child_by_field_name('name')) != path.stem:
                        continue
                else:
                    ancestor = node.parent
                    while ancestor and ancestor.type not in FUNCTIONS:
                        ancestor = ancestor.parent
                    if ancestor:
                        continue
                self.definitions[path, name].append((node.start_point.row + 1, nearby_doc(node)))

    def resolve(self, path, callee):
        """Leave dynamic receivers and shadowed or overloaded names visible without assigning a guessed target."""
        parts = callee.replace('?.', '.').split('.')
        scope, name = path, parts[-1]
        if path.suffix == '.java':
            if len(parts) != 2 or len(self.classes[parts[0]]) != 1:
                return '', ''
            scope = self.classes[parts[0]][0]
        else:
            binding = self.imports[path].get(parts[0])
            if binding and not self.bindings[path][parts[0]]:
                scope, imported = binding
                if imported == '*' and len(parts) != 2 or imported != '*' and len(parts) != 1:
                    return '', ''
                name = name if imported == '*' else imported
            elif len(parts) != 1 or self.bindings[path][name] != 1:
                return '', ''
        found = self.definitions.get((scope, name), [])
        if len(found) != 1:
            return '', ''
        line, doc = found[0]
        return filename(scope) + f'#L{line}', doc


def syntax_notes(path, symbols):
    """Walk every nested function and call once, including anonymous Java and JavaScript callbacks."""
    root = PARSERS[path.suffix].parse(path.read_bytes()).root_node
    if root.has_error:
        raise ValueError(f'Cannot annotate incomplete syntax in {path}')
    notes = []

    def visit(node, owner):
        line, column = node.start_point
        if node.type in FUNCTIONS:
            name = function_name(node)
            doc = nearby_doc(node)
            named = node.type in {'function_declaration', 'generator_function_declaration', 'method_declaration',
                                  'method_definition', 'constructor_declaration'} or node.parent.type == 'variable_declarator'
            if named and not doc:
                raise ValueError(f'Add an English source comment for {name} at {path}:{line + 1}')
            owner = name
            params = node.child_by_field_name('parameters') or node.child_by_field_name('parameter')
            signature = name + (' ' + short(params) if params else '')
            notes.append(Note(line + 1, column + 1, 'Definition', signature + (f' — {doc}' if doc else '')))
        elif node.type in CALLS:
            args = node.child_by_field_name('arguments')
            count = sum(child.type not in {'comment', 'block_comment', 'line_comment'} for child in args.named_children) if args else 0
            text = f'{call_role(node)} {target(node)} with {count} argument' + ('' if count == 1 else 's')
            destination, doc = symbols.resolve(path, target(node))
            notes.append(Note(line + 1, column + 1, 'Call', f'{text} in {owner}.' + (' ' + doc if doc else ''), destination))
        for child in node.named_children:
            visit(child, owner)

    visit(root, 'module or class initialization')
    return notes


DB = runpy.run_path(str(ROOT / 'scripts/index-db-functions.py'))
BODY = re.compile(r'\bas\s+(\$[\w]*\$)', re.I)
# Quoted literals and comments may mention another function without invoking it.
SQL_TEXT = re.compile(r"'(?:''|[^'])*'|--[^\n]*|/\*[\s\S]*?\*/")
QUALIFIED = re.compile(r'\b((?:angler\w*|public)\.[a-z_]\w*)\s*\(', re.I)


def sql_notes(path, known):
    """Annotate historical definitions in place and project-routine invocations inside their SQL bodies."""
    sql = path.read_text()
    starts = [0] + [match.end() for match in re.finditer('\n', sql)]
    notes = []

    def add(offset, kind, message):
        line = bisect.bisect_right(starts, offset)
        notes.append(Note(line, offset - starts[line - 1] + 1, kind, message))

    for match in DB['definition'].finditer(sql):
        if not match.group(1).lower().startswith('create'):
            continue
        name = match.group(2)
        body = BODY.search(sql, match.end())
        if not body:
            raise ValueError(f'Missing SQL body for {path}:{name}')
        end = sql.index(body.group(1), body.end())
        header = ' '.join(sql[match.start(4):body.start()].split())
        add(match.start(1), 'Definition', f'{name}({match.group(3).strip()}) — {header}.')
        code = SQL_TEXT.sub(lambda m: ' ' * len(m.group()), sql[body.end():end])
        for call in QUALIFIED.finditer(code):
            callee = call.group(1).lower()
            if callee in known:
                add(body.end() + call.start(1), 'Call', f'{name} calls {callee} inside this migration definition.')
    return notes


STYLE = '''body{font:15px system-ui;margin:1.5rem;color:#182624}h1{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}
tr{border-bottom:1px solid #e3e7e6}td{vertical-align:top;padding:.2rem .4rem}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.num{color:#465c54;font:13px monospace;width:4em}aside{color:#30584d;min-width:18em}a{color:#16634d}li{margin:.25em 0}'''


def page(title, body):
    """Emit a self-contained offline page. All text originating in code is escaped by the caller."""
    return f'<!doctype html><html lang="en"><meta charset="utf-8"><title>{escape(title)}</title><style>{STYLE}</style><h1>{escape(title)}</h1>{body}</html>'


def render_note(note):
    label = f'{note.kind} · {note.column}'
    if note.destination:
        label = f'<a href="{escape(note.destination, quote=True)}">{label}</a>'
    return f'<div><b>{label}</b> {escape(note.text)}</div>'


def read_coverage(path):
    """Merge LCOV line hits for the same source, including modules imported with query suffixes."""
    hits = defaultdict(dict)
    functions = defaultdict(dict)
    current = None
    if path:
        for line in path.read_text().splitlines():
            if line.startswith('SF:'):
                current = (ROOT / line[3:].split('?', 1)[0]).resolve()
                # Node emits declarations and their counters in the same order, including duplicate names.
                pending = defaultdict(deque)
            elif line.startswith('DA:') and current:
                number, count, *_ = line[3:].split(',')
                number = int(number)
                hits[current][number] = max(hits[current].get(number, 0), int(count))
            elif line.startswith('FN:') and current:
                number, name = line[3:].split(',', 1)
                pending[name].append((int(number), name, len(pending[name])))
            elif line.startswith('FNDA:') and current:
                count, name = line[5:].split(',', 1)
                function = pending[name].popleft()
                functions[current][function] = max(functions[current].get(function, 0), int(count))
            elif line == 'end_of_record':
                current = None
    return hits, functions


def build(output, coverage=None):
    """Write one annotated source listing per first-party runtime file and an index with measured totals."""
    output.mkdir(exist_ok=True, parents=True)
    sources = sorted(path for directory in ('app/src', 'web', 'supabase/functions') for path in (ROOT / directory).rglob('*')
                     if path.suffix in PARSERS and path.name != 'purify.es.mjs' and not path.name.endswith('.d.ts'))
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    known = {name for name, _ in DB['signatures']()}
    for path in migrations:
        known.update(match.group(2).lower() for match in DB['definition'].finditer(path.read_text()))
    hits, functions = read_coverage(coverage)
    missing = []
    symbols = Symbols(sources)
    links = []
    totals = Counter()
    for path in sources + migrations:
        notes = sql_notes(path, known) if path.suffix == '.sql' else syntax_notes(path, symbols)
        grouped = defaultdict(list)
        for note in notes:
            grouped[note.line].append(note)
        title = str(path.relative_to(ROOT))
        output_name = filename(path)
        rows = []
        for number, source in enumerate(path.read_text().splitlines(), 1):
            comments = ''.join(render_note(note) for note in grouped[number])
            count = hits.get(path, {}).get(number)
            badge = '' if count is None else (' · hit' if count else ' · missed')
            rows.append(f'<tr id="L{number}"><td class="num"><a href="#L{number}">{number}</a>{badge}</td><td><pre>{escape(source)}</pre></td><td><aside>{comments}</aside></td></tr>')
        (output / output_name).write_text(page(title, '<a href="index.html">All files</a><table>' + '\n'.join(rows) + '</table>'))
        counts = Counter(note.kind for note in notes)
        totals.update(counts)
        lines = hits.get(path, {})
        observed = f' · Node lines hit {sum(value > 0 for value in lines.values())}/{len(lines)}' if lines else ' · outside this Node run'
        if functions[path]:
            observed += f' · functions reached {sum(count > 0 for count in functions[path].values())}/{len(functions[path])}'
            for (line, name, _), count in sorted(functions[path].items()):
                if not count:
                    missing.append(f'<li><a href="{output_name}#L{line}">{escape(title)} · line {line} · {escape(name)}</a></li>')
        links.append(f'<li><a href="{output_name}">{escape(title)}</a> · {counts["Definition"]} definitions · {counts["Call"]} calls{observed}</li>')
    (output / 'index.html').write_text(page('Annotated application source', '<p>Columns identify UTF-8 byte positions for JavaScript, TypeScript and Java. SQL listings identify project calls in routine bodies. Runtime dispatch is shown as written.</p><ul>' + '\n'.join(links) + '</ul>'))
    if coverage:
        index_path = output / 'index.html'
        index_path.write_text(index_path.read_text() + f'<h2>Functions missed in the Node run ({len(missing)})</h2><ul>' + ''.join(missing) + '</ul>')
    print(f'{len(links)} files, {totals["Definition"]} definitions, {totals["Call"]} call sites')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--coverage', type=Path, help='Optional Node LCOV file with executable line counts')
    args = parser.parse_args()
    build(args.output, args.coverage)
