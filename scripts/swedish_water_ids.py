"""Keep journal references stable when the official Swedish map renumbers its point features."""
from collections import defaultdict
import unicodedata
from uuid import NAMESPACE_URL, uuid5


def identify(rows, previous):
    def identity(row):
        return (unicodedata.normalize('NFKC', row['name']).strip().casefold(),
                tuple(round(value, 5) for value in row['points'][0]))

    known = {}
    for row in previous:
        for point in row['points']:
            key = identity(dict(row, points=[point]))
            if key in known and known[key] != row['code']:
                raise ValueError('Conflicting historical Swedish area identity')
            known[key] = row['code']
    # The production layer can publish the same named reference point in two separate features.
    distinct = {}
    for row in rows:
        key = identity(row)
        if key in distinct and distinct[key] != row:
            raise ValueError('Conflicting Swedish management area attributes')
        distinct[key] = row
    rows = list(distinct.values())
    current = list(distinct)
    assigned = {key: known[key] for key in current if key in known}
    # A previously matched area may also have a second marker that moved.
    def indices(keys):
        names, points = defaultdict(set), defaultdict(set)
        for key in keys:
            names[key[0]].add(key)
            points[key[1]].add(key)
        return names, points
    names, points = indices(known)
    for key in current:
        if key in assigned:
            continue
        same_name = {old for old in names[key[0]] if max(abs(a-b) for a,b in zip(key[1],old[1])) < 0.1}
        options = same_name | points[key[1]]
        if len({known[k] for k in options}) > 1:
            raise ValueError('Ambiguous Swedish management area identity')
        if options:
            old = options.pop()
            assigned[key] = known[old]
        else:
            # The provider supplies no association ID. Persist this initial ID in subsequent editions.
            seed = 'https://fiskekartan.se/area/' + repr(key)
            assigned[key] = 'SE-' + uuid5(NAMESPACE_URL, seed).hex
    areas = {}
    for row, key in zip(rows, current):
        code = assigned[key]
        if code in areas:
            if areas[code]['name'] != row['name']:
                raise ValueError('Conflicting names for one Swedish area')
            areas[code]['points'].extend(row['points'])
        else:
            areas[code] = dict(row, code=code, points=list(row['points']))
    for area in areas.values():
        area['points'].sort()
    return list(areas.values())
