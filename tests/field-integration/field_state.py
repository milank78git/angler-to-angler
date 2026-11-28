"""Read the durable results of actions on the two registered Android clients."""
import json
import subprocess
import uuid


def query(stage, statement):
    fixture = json.loads((stage / 'journal-device.json').read_text())
    config = json.loads((stage / 'local.json').read_text())
    ids = {name: str(uuid.UUID(fixture[name])) for name in
           ('seller', 'buyer', 'proofId', 'parkingId', 'tempId') if name in fixture}
    bindings = [part for key, value in ids.items() for part in ('-v', f'{key}={value}')]
    return subprocess.check_output(['psql', config['DB_URL'], '-XqAt', '-v', 'ON_ERROR_STOP=1', *bindings],
                                   input=statement, text=True, timeout=10).strip()


def provision_reviewer(stage):
    # The fixture grants the operator role only to the other registered test account.
    assert query(stage, """
        insert into angler_private.catch_reviewers(user_id)
        select :'buyer'::uuid where :'buyer'::uuid <> :'seller'::uuid returning 1;
    """) == '1'


def check_evidence(stage, state):
    found = json.loads(query(stage, """
        select coalesce((select jsonb_build_array(outcome,length_mm,reviewer=:'buyer'::uuid,
          photo is not null,water is not null,lat100 is not null,lon100 is not null)
          from angler_private.catch_evidence where catch_id=:'proofId' and user_id=:'seller'), 'null');
    """))
    expected = {'absent': None, 'pending': ['pending', None, None, True, True, True, True],
                'measured': ['measured', 317, True, False, False, False, False]}
    assert found == expected[state], f'Evidence state {state}: {found}'


def check_parking(stage, owner, peer, peer_note=True):
    found = json.loads(query(stage, """
        select json_build_object(
          'location', (select json_build_array(water, name, creator=:'seller'::uuid)
            from angler_activity.parking_points where id=:'parkingId'),
          'temporary', exists(select from angler_activity.parking_points where id=:'tempId'),
          'reviews', (select coalesce(jsonb_object_agg(author::text, jsonb_build_array(stars,note)),'{}')
            from angler_activity.parking_reviews where point=:'parkingId'));
    """))
    fixture = json.loads((stage / 'journal-device.json').read_text())
    reviews = {}
    if owner:
        reviews[fixture['seller']] = [3, 'Owner access note']
    if peer:
        reviews[fixture['buyer']] = [5, 'Walk along the marked path' if peer_note else None]
    assert found == {'location': ['CZ:401009', 'Upper gravel pull-in', True if owner else None],
                     'temporary': False, 'reviews': reviews}, f'Parking ownership or feedback differs: {found}'


def check_discussion(stage, replied=False, marked=False):
    # Identify the fixture by both the registered author and its text to catch duplicate publication.
    result = json.loads(query(stage, """
        with roots as (select id,water from angler_discussions.posts
          where author_id=:'seller' and body='Footpath beside the mill' and parent is null)
        select jsonb_build_array(
          (select count(*) from roots),
          (select count(*) from roots where water='CZ:401009'),
          (select count(*) from angler_discussions.posts
             where author_id=:'seller' and body='Temporary observation'),
          (select coalesce(jsonb_agg(jsonb_build_array(p.author_id=:'buyer'::uuid,p.body,p.helpful,
             p.water=r.water)),'[]') from roots r join angler_discussions.posts p on p.parent=r.id)
        );
    """))
    answers = [[True, 'Confirmed from the bridge', marked, True]] if replied else []
    assert result == [1, 1, 0, answers], f'Discussion ownership, thread or helpful mark differs: {result}'
