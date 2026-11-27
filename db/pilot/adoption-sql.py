"""Emit only the missing SQL for the reviewed hosted pilot as of 26 November 2026."""
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree

root = Path(__file__).resolve().parents[2]
changelog = root / 'db/changelog.xml'
files = {}
checksum = sha256()
for changeset in ElementTree.parse(changelog).getroot():
    if changeset.get('id') == 'hosted-pilot-20261126':
        break
    checksum.update(ElementTree.tostring(changeset).strip())
    sql = changeset.find('{*}sqlFile')
    if sql is not None:
        contents = (changelog.parent / sql.get('path')).read_bytes()
        checksum.update(contents)
        files[changeset.get('id')] = contents.decode('utf-8')
else:
    raise SystemExit('Hosted pilot baseline tag missing')
if checksum.hexdigest() != '26ae3a99923ea5974aaec8e4d6c91aae3d7ed01ce3904ab0af34fb3f81a2d360':
    raise SystemExit('Historical changesets differ from the reviewed pilot baseline')

# The pilot installed the market timezone fix and the reviewed-contributor functions
# separately. The group prerequisites already installed the write counter and trigger function.
# Age registration superseded angler_profile and revoked the old angler_accept grant.
sections = [
    ('20261125154159', None),
    ('20261126021000', 'create function angler_private.nickname_key'),
    ('20261126045000', None),
    ('20261126060000', 'create trigger limit_posts'),
    ('20261126060100', None),
    ('20261126060200', 'create or replace function public.angler_accept'),
]
for version, first_statement in sections:
    contents = files[version]
    start = contents.index(first_statement) if first_statement else 0
    print(contents[start:])
