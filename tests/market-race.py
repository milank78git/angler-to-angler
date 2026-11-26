"""Run against the disposable profile fixture database after committing its test accounts."""
import concurrent.futures
import os
import subprocess
import time
import uuid


def sql(statement, name="market-fixture"):
    return subprocess.run(
        ["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
        input=statement, text=True, capture_output=True,
        env={**os.environ, "PGAPPNAME": name}, timeout=15,
    )


def success(result):
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def as_user(number):
    return ("begin; set local role authenticated; "
            f"set local \"request.jwt.claim.sub\"='00000000-0000-4000-8000-{number:012}'; ")


def offer(title):
    offer_id = str(uuid.uuid4())
    draft = ('{"title":"' + title + '","species":"Pike","access":"shore","day":"2026-01-01",'
             '"technique":"Use a slow retrieve","water":null,"price":80,"limit":1}')
    success(sql(as_user(71) + f"select public.angler_market_publish('{offer_id}',0,'{draft}'); commit;"))
    return offer_id


def buy(number, offer_id):
    return as_user(number) + f"select public.angler_market_buy('{offer_id}',1,80);"


def overlap(first, second, expected):
    # Hold the first transaction open after its write. Start the competing client
    # only when the server confirms that the first client is sleeping with its locks.
    with concurrent.futures.ThreadPoolExecutor() as pool:
        winner = pool.submit(sql, first + "select pg_sleep(2); commit;", "market-holder")
        for _ in range(80):
            if success(sql("select exists(select from pg_stat_activity where "
                           "application_name='market-holder' and wait_event='PgSleep');")) == "t":
                break
            time.sleep(0.02)
        else:
            raise AssertionError("First buyer did not obtain its locks")
        competitor = sql(second + "commit;")
        success(winner.result())
        if competitor.returncode == 0 or expected not in competitor.stderr:
            raise AssertionError("Unexpected competing purchase result: " + competitor.stderr)


# Use fresh buyers. 71 is the fixture's confirmed seller.
for n in (75, 76):
    success(sql(f"insert into auth.users values ('00000000-0000-4000-8000-{n:012}',now());" +
                as_user(n) + f"select public.angler_register('Race {n}','2026-11-26.2','2026-11-26.2','1980-01-01');"
                "select public.angler_market_activate(); commit;"))

last, left, right = (offer(title) for title in ("Last slot", "Wallet A", "Wallet B"))
overlap(buy(75, last), buy(76, last), "PT409")
overlap(buy(76, left), buy(76, right), "PT402")
assert success(sql(f"select sold from angler_market.offers where id='{right}'")) == "0"
assert success(sql(f"select count(*) from angler_market.orders where offer in ('{last}','{left}','{right}')")) == "2"
for n in (75, 76):
    assert success(sql(f"select balance from angler_market.wallets where holder='00000000-0000-4000-8000-{n:012}'")) == "20"
print("Last-slot and cross-offer wallet races passed")

# Two devices rate the same purchase concurrently. Only the first set of scores may win.
def rating(accuracy):
    return as_user(75) + f"select public.angler_market_rate('{last}',{accuracy},4,3);"


overlap(rating(5), rating(1), "PT409")
assert success(sql(f"select count(*) from angler_market.orders where offer='{last}' and rating_accuracy=5")) == "1"
print("Concurrent ratings preserved the first receipt")

# Exercise the commercial sales path with the same live database lock coordination.
success(sql("update angler_commerce.settings set mode='test';"))
commercial = [offer(title) for title in ("Play last slot", "Play wallet A", "Play wallet B")]
for offer_id in commercial:
    success(sql(as_user(71) + f"""select public.angler_commerce('enroll',
        jsonb_build_object('offer','{offer_id}','revision',1)); commit;"""))

for number in (75, 76):
    success(sql(f"""select public.angler_play_receipt('credit',jsonb_build_object(
        'holder','00000000-0000-4000-8000-{number:012}','mode','test','sku','credits_100_czk',
        'order','parallel-order-{number}','hash',encode(sha256('parallel-{number}'::bytea),'hex')));"""))

def commercial_buy(number, offer_id):
    return as_user(number) + f"""select public.angler_commerce('buy',
        jsonb_build_object('offer','{offer_id}','revision',1,'price',80));"""

overlap(commercial_buy(75, commercial[0]), commercial_buy(76, commercial[0]), "PT409")
overlap(commercial_buy(76, commercial[1]), commercial_buy(76, commercial[2]), "PT402")
for number in (75, 76):
    assert success(sql(as_user(number) + "select public.angler_commerce('status')->>'balance'; commit;")) == "30"
assert success(sql(f"select sold from angler_market.offers where id='{commercial[2]}'")) == "0"
print("Play last-slot and cross-offer wallet races passed")
