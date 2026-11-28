"""Observe mobile actions through independent PostgreSQL and anonymous HTTP reads."""
import json
import subprocess
import urllib.request
import uuid


def market_state(stage):
    fixture = json.loads((stage / 'journal-device.json').read_text())
    config = json.loads((stage / 'local.json').read_text())
    # Bind test values as psql variables. Read the sale, version and wallet in one snapshot.
    query = """
        select json_build_object(
          'revision', o.revision, 'withdrawn', o.withdrawn, 'sold', o.sold,
          'versions', (select count(*) from angler_market.versions v where v.offer=o.id),
          'orders', (select count(*) from angler_market.orders b where b.offer=o.id),
          'paid_revision', (select b.revision from angler_market.orders b
                            where b.offer=o.id and b.buyer=nullif(:'buyer','')::uuid),
          'balance', (select w.balance from angler_market.wallets w where w.holder=nullif(:'buyer','')::uuid)
        )
        from angler_market.offers o join angler_market.versions first on first.offer=o.id and first.revision=1
        where o.seller=:'seller'::uuid and first.title=:'title';
    """
    rows = subprocess.check_output(
        ['psql', config['DB_URL'], '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v',
         'seller=' + str(uuid.UUID(fixture['seller'])), '-v', 'title=' + fixture['offerTitle'],
         '-v', 'buyer=' + (str(uuid.UUID(fixture['buyer'])) if 'buyer' in fixture else '')],
        input=query, text=True, timeout=12).splitlines()
    assert len(rows) == 1, 'Expected exactly one published offer'
    return json.loads(rows[0])


def check_sale(stage, *, paid, revision=1, withdrawn=False, balance=None):
    actual = market_state(stage)
    expected = {'revision': revision, 'withdrawn': withdrawn, 'sold': int(paid), 'versions': revision,
                'orders': int(paid), 'paid_revision': 1 if paid else None, 'balance': balance}
    assert actual == expected, f'Persisted purchase mismatch: {actual} != {expected}'


def check_public_card(stage, active):
    fixture = json.loads((stage / 'journal-device.json').read_text())
    config = json.loads((stage / 'local.json').read_text())
    token = str(uuid.UUID(fixture['cardToken']))
    request = urllib.request.Request('http://127.0.0.1:54321/rest/v1/rpc/angler_open_catch_card',
        data=json.dumps({'link_id': token}).encode(),
        headers={'Content-Type': 'application/json', 'apikey': config['ANON_KEY']})
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.status in (200, 204)
        body = response.read().strip()
    card = json.loads(body) if body else None
    if active:
        # Compare the entire public payload to detect accidental new fields, including null-valued fields.
        assert card == {'precision': 'month', 'species': 'Field perch', 'date': '2024-05',
                        'name': 'FieldAnglerTwo'}, 'Anonymous payload differs from the agreed public fields'
    else:
        assert card is None, 'A fresh anonymous reader can still open the withdrawn card'
